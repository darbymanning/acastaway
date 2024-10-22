import { paramCase as param_case } from "https://deno.land/x/case@2.2.0/mod.ts"
import rss_to_json from "npm:rss-to-json@2.1.1"
import { isAxiosError } from "npm:axios@1.7.7"
import type { StatusCode } from "hono/utils/http-status"

export interface AcastResponse {
  title: string
  description: string
  link: string
  image: string
  category: Array<string>
  items: Array<Episode>
}

interface Episode {
  id: string
  title: string
  description: string
  link: string
  published: number
  created: number
  category: Array<string>
  enclosures: Array<{
    url: string
    length: `"${number}"`
    type: string // "audio/mpeg"
  }>
  itunes_summary: string
  itunes_duration: string // "00:00:00"
  itunes_episodeType: "full" | "trailer" | "bonus"
  itunes_image: {
    href: string
  }
  media: Record<string, unknown>
}

class Acast {
  #strip(str: string) {
    return str.replace(
      "<br /><hr><p style='color:grey; font-size:0.75em;'> Hosted on Acast. See <a style='color:grey;' target='_blank' rel='noopener noreferrer' href='https://acast.com/privacy'>acast.com/privacy</a> for more information.</p>",
      "",
    )
  }

  async get(id: string) {
    try {
      const url = new URL(`public/shows/${id}`, "https://feeds.acast.com")
      const feed = (await rss_to_json.parse(url.toString())) as AcastResponse

      return {
        error: null,
        feed: {
          description: this.#strip(feed.description),
          image: feed.image,
          items: feed.items.map((entry) => ({
            created: new Date(entry.created).toISOString(),
            description: this.#strip(entry.description),
            enclosures: entry.enclosures.map((enclosure) => ({
              length: Number(enclosure.length),
              type: enclosure.type,
              url: enclosure.url,
            })),
            id: entry.id,
            itunes: {
              duration: entry.itunes_duration,
              image: entry.itunes_image.href,
              summary: this.#strip(entry.itunes_summary),
              type: entry.itunes_episodeType,
            },
            published: new Date(entry.published).toISOString(),
            slug: param_case(entry.title),
            title: entry.title,
          })),
          link: feed.link,
          title: feed.title,
        },
      }
    } catch (e) {
      if (isAxiosError(e)) {
        return {
          error: {
            message: e.response?.data.message,
            status: (e.response?.status ?? 500) as StatusCode,
          },
          feed: null,
        }
      }

      return {
        error: {
          ...e as Error,
          status: 500 as StatusCode,
        },
        feed: null,
      }
    }
  }
}

export const acast = new Acast()
