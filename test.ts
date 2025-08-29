import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"

// mock the acast module before importing main.ts
const mock_episodes = [
  {
    id: "episode-1",
    title: "Episode 1",
    description: "First episode",
    created: "2025-01-01T00:00:00.000Z",
    published: "2025-01-01T00:00:00.000Z",
    enclosures: [{
      url: "http://example.com/1.mp3",
      length: 1000,
      type: "audio/mpeg",
    }],
    itunes: {
      duration: "10:00",
      image: "http://example.com/1.jpg",
      summary: "First episode",
      type: "full" as const,
    },
    slug: "episode-1",
  },
  {
    id: "episode-2",
    title: "Episode 2",
    description: "Second episode",
    created: "2025-01-02T00:00:00.000Z",
    published: "2025-01-02T00:00:00.000Z",
    enclosures: [{
      url: "http://example.com/2.mp3",
      length: 2000,
      type: "audio/mpeg",
    }],
    itunes: {
      duration: "20:00",
      image: "http://example.com/2.jpg",
      summary: "Second episode",
      type: "full" as const,
    },
    slug: "episode-2",
  },
  {
    id: "episode-3",
    title: "Episode 3",
    description: "Third episode",
    created: "2025-01-03T00:00:00.000Z",
    published: "2025-01-03T00:00:00.000Z",
    enclosures: [{
      url: "http://example.com/3.mp3",
      length: 3000,
      type: "audio/mpeg",
    }],
    itunes: {
      duration: "30:00",
      image: "http://example.com/3.jpg",
      summary: "Third episode",
      type: "full" as const,
    },
    slug: "episode-3",
  },
  {
    id: "episode-4",
    title: "Episode 4",
    description: "Fourth episode",
    created: "2025-01-04T00:00:00.000Z",
    published: "2025-01-04T00:00:00.000Z",
    enclosures: [{
      url: "http://example.com/4.mp3",
      length: 4000,
      type: "audio/mpeg",
    }],
    itunes: {
      duration: "40:00",
      image: "http://example.com/4.jpg",
      summary: "Fourth episode",
      type: "full" as const,
    },
    slug: "episode-4",
  },
  {
    id: "episode-5",
    title: "Episode 5",
    description: "Fifth episode",
    created: "2025-01-05T00:00:00.000Z",
    published: "2025-01-05T00:00:00.000Z",
    enclosures: [{
      url: "http://example.com/5.mp3",
      length: 5000,
      type: "audio/mpeg",
    }],
    itunes: {
      duration: "50:00",
      image: "http://example.com/5.jpg",
      summary: "Fifth episode",
      type: "full" as const,
    },
    slug: "episode-5",
  },
]

// mock acast class that extends the real Acast
import { Acast } from "./acast.ts"

class MockAcast extends Acast {
  private episodes = [...mock_episodes]

  override async get(id: string) {
    return {
      error: null,
      feed: {
        title: "Test Podcast",
        description: "A test podcast",
        link: "http://example.com",
        image: "http://example.com/image.jpg",
        items: this.episodes.map((episode) => ({
          ...episode,
          created: episode.created,
          published: episode.published,
          enclosures: episode.enclosures,
          itunes: episode.itunes,
        })),
      },
    }
  }

  // method to add a new episode (simulating acast webhook)
  add_episode(episode: typeof mock_episodes[0]) {
    this.episodes.unshift(episode) // add to beginning
  }
}

// mock the acast module
const mock_acast = new MockAcast()

// test runner
Deno.test("acastaway cache invalidation tests", async (t) => {
  // set the mock acast instance
  const { set_acast_instance } = await import("./acast.ts")
  set_acast_instance(mock_acast)

  // import the real app
  const { app } = await import("./main.ts")

  // start the real server on a different port
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

    await t.step(
      "add new episode and verify it's not returned due to caching",
      async () => {
        // add new episode
        mock_acast.add_episode({
          id: "episode-new",
          title: "New Episode",
          description: "A new episode",
          created: "2025-01-06T00:00:00.000Z",
          published: "2025-01-06T00:00:00.000Z",
          enclosures: [{
            url: "http://example.com/new.mp3",
            length: 6000,
            type: "audio/mpeg",
          }],
          itunes: {
            duration: "60:00",
            image: "http://example.com/new.jpg",
            summary: "New episode",
            type: "full" as const,
          },
          slug: "new-episode",
        })

        // should still return cached data (old episodes)
        const response = await fetch("http://localhost:8001/test-id")
        const data = await response.json()

        assertEquals(data.items.length, 5)
        assertEquals(data.items[0].id, "episode-1") // should still be first
        assertEquals(data.items[4].id, "episode-5") // should still be last
      },
    )

    await t.step(
      "GET /:id?limit=5 should still return cached data",
      async () => {
        const response = await fetch("http://localhost:8001/test-id?limit=5")
        const data = await response.json()

        assertEquals(data.items.length, 5)
        assertEquals(data.items[0].id, "episode-1")
        assertEquals(data.items[4].id, "episode-5")
      },
    )

    await t.step(
      "GET /:id?limit=6 should return new episode since it was never cached",
      async () => {
        const response = await fetch("http://localhost:8001/test-id?limit=6")
        const data = await response.json()

        assertEquals(data.items.length, 6)
        assertEquals(data.items[0].id, "episode-new") // new episode should be first
        assertEquals(data.items[1].id, "episode-1")
        assertEquals(data.items[5].id, "episode-5")
      },
    )

    await t.step("POST /:id should invalidate cache", async () => {
      const response = await fetch("http://localhost:8001/test-id", {
        method: "POST",
      })
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

    await t.step(
      "after POST, GET /:id?limit=5 should return new episode",
      async () => {
        const response = await fetch("http://localhost:8001/test-id?limit=5")
        const data = await response.json()

        assertEquals(data.items.length, 5)
        assertEquals(data.items[0].id, "episode-new") // new episode should be first
        assertEquals(data.items[1].id, "episode-1")
        assertEquals(data.items[4].id, "episode-4")
      },
    )

    await t.step("POST / (webhook) should purge cache for show ID", async () => {
      // first, add a new episode to verify caching
      mock_acast.add_episode({
        id: "episode-webhook",
        title: "Webhook Episode",
        description: "A webhook episode",
        created: "2025-01-07T00:00:00.000Z",
        published: "2025-01-07T00:00:00.000Z",
        enclosures: [{
          url: "http://example.com/webhook.mp3",
          length: 7000,
          type: "audio/mpeg",
        }],
        itunes: {
          duration: "70:00",
          image: "http://example.com/webhook.jpg",
          summary: "Webhook episode",
          type: "full" as const,
        },
        slug: "webhook-episode",
      })

      // verify it's not returned due to caching
      const response1 = await fetch("http://localhost:8001/test-id")
      const data1 = await response1.json()
      assertEquals(data1.items.length, 6) // should still be 6, not 7
      assertEquals(data1.items[0].id, "episode-new") // should still be first

      // send webhook POST to root endpoint
      const webhook_body = {
        event: "episodePublished",
        id: "68b19fb2e9dcbdcab9422bcd",
        title: "asd",
        status: "published",
        publishDate: "2025-08-29T12:40:17.897Z",
        coverUrl: "https://open-static.acast.com/global/images/default-cover.png",
        audioUrl: "https://assets.pippa.io/shows/test-id/1756471180495-09ec73c1-7d20-4a7d-bada-74640a2ea0f4.m4a"
      }

      const webhook_response = await fetch("http://localhost:8001/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(webhook_body),
      })

      assertEquals(webhook_response.status, 204) // no content

      // verify cache is purged and new episode is returned
      const response2 = await fetch("http://localhost:8001/test-id")
      const data2 = await response2.json()
      assertEquals(data2.items.length, 7) // should now be 7
      assertEquals(data2.items[0].id, "episode-webhook") // new episode should be first
    })
  } finally {
    server.shutdown()
  }
})
