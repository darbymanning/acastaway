import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { Hono } from "hono"
import { cache } from "hono/cache"
import { cors } from "hono/cors"
import { z } from "https://deno.land/x/zod@v3.23.8/mod.ts"

// mock acast data
const mock_episodes = [
  {
    id: "episode-1",
    title: "Episode 1",
    description: "First episode",
    created: "2025-01-01T00:00:00.000Z",
    published: "2025-01-01T00:00:00.000Z",
    enclosures: [{ url: "http://example.com/1.mp3", length: 1000, type: "audio/mpeg" }],
    itunes: { duration: "10:00", image: "http://example.com/1.jpg", summary: "First episode", type: "full" as const },
    slug: "episode-1",
  },
  {
    id: "episode-2", 
    title: "Episode 2",
    description: "Second episode",
    created: "2025-01-02T00:00:00.000Z",
    published: "2025-01-02T00:00:00.000Z",
    enclosures: [{ url: "http://example.com/2.mp3", length: 2000, type: "audio/mpeg" }],
    itunes: { duration: "20:00", image: "http://example.com/2.jpg", summary: "Second episode", type: "full" as const },
    slug: "episode-2",
  },
  {
    id: "episode-3",
    title: "Episode 3", 
    description: "Third episode",
    created: "2025-01-03T00:00:00.000Z",
    published: "2025-01-03T00:00:00.000Z",
    enclosures: [{ url: "http://example.com/3.mp3", length: 3000, type: "audio/mpeg" }],
    itunes: { duration: "30:00", image: "http://example.com/3.jpg", summary: "Third episode", type: "full" as const },
    slug: "episode-3",
  },
  {
    id: "episode-4",
    title: "Episode 4",
    description: "Fourth episode", 
    created: "2025-01-04T00:00:00.000Z",
    published: "2025-01-04T00:00:00.000Z",
    enclosures: [{ url: "http://example.com/4.mp3", length: 4000, type: "audio/mpeg" }],
    itunes: { duration: "40:00", image: "http://example.com/4.jpg", summary: "Fourth episode", type: "full" as const },
    slug: "episode-4",
  },
  {
    id: "episode-5",
    title: "Episode 5",
    description: "Fifth episode",
    created: "2025-01-05T00:00:00.000Z", 
    published: "2025-01-05T00:00:00.000Z",
    enclosures: [{ url: "http://example.com/5.mp3", length: 5000, type: "audio/mpeg" }],
    itunes: { duration: "50:00", image: "http://example.com/5.jpg", summary: "Fifth episode", type: "full" as const },
    slug: "episode-5",
  },
]

// mock acast class
class MockAcast {
  private episodes = [...mock_episodes]
  
  async get(id: string) {
    return {
      error: null,
      feed: {
        title: "Test Podcast",
        description: "A test podcast",
        link: "http://example.com",
        image: "http://example.com/image.jpg",
        items: this.episodes,
      },
    }
  }
  
  // method to add a new episode (simulating acast webhook)
  add_episode(episode: typeof mock_episodes[0]) {
    this.episodes.unshift(episode) // add to beginning
  }
}

const mock_acast = new MockAcast()

// test app setup
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
let cache_version = 1

const pagination_schema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().positive().default(10),
})

function paginate<T>(items: Array<T>, page: number, limit: number): Array<T> {
  const start = (page - 1) * limit
  const end = start + limit
  return items.slice(start, end)
}

// webhook endpoint
app.post("/:id", async (c) => {
  const { id } = c.req.param()
  
  // increment cache version to invalidate all caches for this ID
  cache_version++
  
  return c.json({
    message: `Cache refreshed for ${id}`,
    cache_cleared: true,
  })
})

// main endpoint
app.get(
  "/:id",
  cache({
    cacheName: (c) => `${c.req.param().id}-v${cache_version}`,
    cacheControl: cache_control,
    wait: true,
  }),
  async (c) => {
    const { id } = c.req.param()

    try {
      const { page, limit } = pagination_schema.parse(c.req.query())

      // fetch feed
      const { error, feed } = await mock_acast.get(id)
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
          cache_version,
        },
      })
    } catch (e) {
      if (e instanceof z.ZodError) return c.json({ errors: e.errors }, 400)
    }
  },
)

// test runner
Deno.test("acastaway cache invalidation tests", async (t) => {
  const server = Deno.serve({ port: 8001 }, app.fetch)
  
  try {
    await t.step("GET /:id returns list of episodes", async () => {
      const response = await fetch("http://localhost:8001/test-id")
      const data = await response.json()
      
      assertEquals(data.title, "Test Podcast")
      assertEquals(data.items.length, 5)
      assertEquals(data.total_items, 5)
      assertEquals(data.items[0].id, "episode-1")
      assertEquals(data.items[4].id, "episode-5")
    })

    await t.step("GET /:id?limit=5 returns 5 episodes", async () => {
      const response = await fetch("http://localhost:8001/test-id?limit=5")
      const data = await response.json()
      
      assertEquals(data.limit, 5)
      assertEquals(data.items.length, 5)
      assertEquals(data.items[0].id, "episode-1")
      assertEquals(data.items[4].id, "episode-5")
    })

    await t.step("GET /:id?limit=3 returns 3 episodes", async () => {
      const response = await fetch("http://localhost:8001/test-id?limit=3")
      const data = await response.json()
      
      assertEquals(data.limit, 3)
      assertEquals(data.items.length, 3)
      assertEquals(data.items[0].id, "episode-1")
      assertEquals(data.items[2].id, "episode-3")
    })

    await t.step("add new episode and verify it's not returned due to caching", async () => {
      // add new episode
      mock_acast.add_episode({
        id: "episode-new",
        title: "New Episode",
        description: "A new episode",
        created: "2025-01-06T00:00:00.000Z",
        published: "2025-01-06T00:00:00.000Z",
        enclosures: [{ url: "http://example.com/new.mp3", length: 6000, type: "audio/mpeg" }],
        itunes: { duration: "60:00", image: "http://example.com/new.jpg", summary: "New episode", type: "full" as const },
        slug: "new-episode",
      })
      
      // should still return cached data (old episodes)
      const response = await fetch("http://localhost:8001/test-id")
      const data = await response.json()
      
      assertEquals(data.items.length, 5)
      assertEquals(data.items[0].id, "episode-1") // should still be first
      assertEquals(data.items[4].id, "episode-5") // should still be last
    })

    await t.step("GET /:id?limit=5 should still return cached data", async () => {
      const response = await fetch("http://localhost:8001/test-id?limit=5")
      const data = await response.json()
      
      assertEquals(data.items.length, 5)
      assertEquals(data.items[0].id, "episode-1")
      assertEquals(data.items[4].id, "episode-5")
    })

    await t.step("GET /:id?limit=6 should return new episode since it was never cached", async () => {
      const response = await fetch("http://localhost:8001/test-id?limit=6")
      const data = await response.json()
      
      assertEquals(data.items.length, 6)
      assertEquals(data.items[0].id, "episode-new") // new episode should be first
      assertEquals(data.items[1].id, "episode-1")
      assertEquals(data.items[5].id, "episode-5")
    })

    await t.step("POST /:id should invalidate cache", async () => {
      const response = await fetch("http://localhost:8001/test-id", { method: "POST" })
      const data = await response.json()
      
      assertEquals(data.cache_cleared, true)
    })

    await t.step("after POST, GET /:id should return new episode", async () => {
      const response = await fetch("http://localhost:8001/test-id")
      const data = await response.json()
      
      assertEquals(data.items.length, 6)
      assertEquals(data.items[0].id, "episode-new") // new episode should be first
      assertEquals(data.items[1].id, "episode-1")
      assertEquals(data.items[5].id, "episode-5")
    })

    await t.step("after POST, GET /:id?limit=5 should return new episode", async () => {
      const response = await fetch("http://localhost:8001/test-id?limit=5")
      const data = await response.json()
      
      assertEquals(data.items.length, 5)
      assertEquals(data.items[0].id, "episode-new") // new episode should be first
      assertEquals(data.items[1].id, "episode-1")
      assertEquals(data.items[4].id, "episode-4")
    })

  } finally {
    server.shutdown()
  }
})
