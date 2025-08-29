import { Hono } from "hono"
import { cache } from "hono/cache"
import { cors } from "hono/cors"
import { acast } from "./acast.ts"
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts"

const app = new Hono()

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
    exposeHeaders: ["*"],
    credentials: true,
    maxAge: 86400,
  }),
)

const cache_control = "max-age=3600"

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

app.get("/", (c) => {
  return c.redirect("https://github.com/darbymanning/acastaway", 307)
})

// Webhook will call this to refresh the cache for a specific ID
app.post("/:id", async (c) => {
  const { id } = c.req.param()

  // Fetch the feed to immediately repopulate the cache
  const { error, feed } = await acast.get(id)
  if (error) return c.json(error)

  const base_url = c.req.url.replace("/" + id, "")

  // clear cache by deleting the base entry - hono cache will handle the rest
  const cache_storage = await caches.open(id)
  await cache_storage.delete(new Request(`${base_url}/${id}`))

  // store the new feed data for the base URL
  await cache_storage.put(
    new Request(`${base_url}/${id}`),
    new Response(JSON.stringify(feed), {
      headers: {
        "content-type": "application/json",
        "cache-control": cache_control,
      },
    }),
  )

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

    // clear cache by deleting the base entry
    await cache_storage.delete(new Request(`${base_url}/${id}`))

    // verify deletion
    const still_cached = await cache_storage.match(
      new Request(`${base_url}/${id}`),
    )

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
    cacheName: (c) => c.req.param().id, // use id as cache name
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

// Start the server
Deno.serve(app.fetch)
