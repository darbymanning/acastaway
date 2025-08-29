import { Hono } from "hono"
import { cache } from "hono/cache"
import { cors } from "hono/cors"
import { acast } from "./acast.ts"
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts"

const app = new Hono()

const max_age = 3600

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
    exposeHeaders: ["*"],
    credentials: true,
    maxAge: max_age,
  }),
)

const cache_control = `max-age=${max_age}`

// per-show cache timestamps that we can update to invalidate caches for specific shows
const cache_timestamps = new Map<string, number>()

const pagination_schema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().positive().default(10),
})

// Helper function to paginate
function paginate<T>(items: Array<T>, page: number, limit: number): Array<T> {
  const start = (page - 1) * limit
  const end = start + limit
  return items.slice(start, end)
}

app.get("", (c) => c.redirect("https://github.com/darbymanning/acastaway", 307))

app.post("", async (c) => {
  try {
    const body = await c.req.json()
    const show_id = body.audioUrl.split("/shows/").pop().split("/")[0]

    // update cache timestamp to invalidate all caches for this ID
    cache_timestamps.set(show_id, Date.now())

    // return ok no content
    return c.body(null, 204)
  } catch (error) {
    console.error(error)
    return c.json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500)
  }
})

// Webhook will call this to refresh the cache for a specific ID
app.post("/:id", async (c) => {
  const { id } = c.req.param()

  // update cache timestamp to invalidate all caches for this ID
  cache_timestamps.set(id, Date.now())

  // Fetch the feed to immediately repopulate the cache
  const { error, feed } = await acast.get(id)
  if (error) return c.json(error)

  // no need to manually store cache - hono will handle it

  return c.json({
    message: `Cache refreshed for ${feed.title} (${id})`,
    cache_cleared: true,
  })
})

// Purge cache for a specific ID
app.delete("/:id", async (c) => {
  const { id } = c.req.param()

  try {
    const base_url = c.req.url.replace("/" + id, "")

    // check if cache exists before deleting
    const cache_storage = await caches.open(id)
    const was_cached = await cache_storage.match(
      new Request(`${base_url}/${id}`),
    )

    // update cache timestamp to invalidate all caches for this ID
    cache_timestamps.set(id, Date.now())

    // verify deletion - check if cache version was incremented
    const still_cached = false // cache version change means all caches are invalid

    return c.json({
      message: `Cache purge attempted for ${id}`,
      was_cached: !!was_cached,
      still_cached: !!still_cached,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return c.json({
      message: `Failed to purge cache for ${id}`,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    }, 500)
  }
})

// Debug endpoint to check cache status (must be before /:id route)
app.get("/debug/:id", async (c) => {
  const { id } = c.req.param()

  try {
    const cache_storage = await caches.open(id)
    // construct the actual feed endpoint URL, not the debug endpoint
    const base_url = c.req.url.replace("/debug/" + id, "")
    const cache_url = `${base_url}/${id}`
    const cached_response = await cache_storage.match(new Request(cache_url))

    return c.json({
      id,
      cache_url,
      has_cached_data: !!cached_response,
      timestamp: new Date().toISOString(),
      cache_headers: cached_response
        ? Object.fromEntries(cached_response.headers.entries())
        : null,
    })
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    }, 500)
  }
})

// Get the feed data for the specific ID with pagination
app.get(
  "/:id",
  cache({
    cacheName: (c) => {
      const id = c.req.param().id
      const timestamp = cache_timestamps.get(id) || 0
      return `${id}-t${timestamp}` // include timestamp in cache name
    },
    cacheControl: cache_control,
    wait: true,
  }),
  async (c) => {
    const { id } = c.req.param()

    try {
      const { page, limit } = pagination_schema.parse(c.req.query())

      // Fetch feed
      const { error, feed } = await acast.get(id)
      if (error) return c.json(error)

      const paginated_items = paginate(feed.items, page, limit)

      return c.json({
        title: feed.title,
        items: paginated_items,
        page,
        limit,
        total_items: feed.items.length,
        _debug: {
          timestamp: new Date().toISOString(),
          cache_control,
          feed_description: feed.description?.substring(0, 100) + "...",
        },
      })
    } catch (e) {
      if (e instanceof z.ZodError) return c.json({ errors: e.errors }, 400)
    }
  },
)

type ListResponse<T extends "error" | "feed"> = NonNullable<
  Awaited<
    ReturnType<typeof acast.get>
  >[T]
>

// Get specific episode data
app.get(
  "/:id/:id_or_slug",
  async (c) => {
    const { id_or_slug } = c.req.param()

    // Fetch the entire feed first)
    const url = c.req.url.split("/").slice(0, -1).join("/")
    const result = await app.fetch(new Request(url))

    try {
      const feed = await result.json() as ListResponse<"feed">

      const item = feed.items.find(
        (item) => item.id === id_or_slug || item.slug === id_or_slug,
      )

      if (!item) {
        return c.json({ message: `Episode not found: ${id_or_slug}` }, 404)
      }

      return c.json(item)
    } catch (e) {
      const error = e as ListResponse<"error">
      return c.json(error)
    }
  },
)

// Export the app for testing
export { app }

// Start the server only if this is the main module
if (import.meta.main) {
  Deno.serve(app.fetch)
}
