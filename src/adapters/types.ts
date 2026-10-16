// The interface every provider adapter has. An adapter maps the provider's
// own JSON to foxcache/v1 and reaches the network only through Http, which
// sends only the adapter's reads. docs/providers/<id>.md lists each endpoint
// and its source.
import type { Http, HttpSite } from "../http.js";
import type { Conversation, LibraryItem, Memory, Preference, Project, ProviderId } from "../schema.js";

/** One row of a conversation list. */
export interface Stub {
  id: string;
  title: string;
  updatedAt: string;
}
export interface ListPage {
  items: Stub[];
  /** The cursor of the next page. Undefined at the end of the list. */
  next?: string;
}

export interface Adapter extends HttpSite {
  id: ProviderId;
  label: string;
  /** True when the list is sorted by updatedAt, newest first: a capture that may stop early (CaptureOptions.earlyStop) stops at the first page with no change. */
  newestFirst: boolean;
  /** True when the user is signed in. A 401 or 403 means false. */
  detect(http: Http): Promise<boolean>;
  /** One page of the conversation list. The first page has no cursor. */
  listConversations(http: Http, cursor?: string): Promise<ListPage>;
  getConversation(http: Http, stub: Stub): Promise<Conversation>;
  projects?(http: Http): Promise<Project[]>;
  memories?(http: Http): Promise<Memory[]>;
  preferences?(http: Http): Promise<Preference[]>;
  library?(http: Http): Promise<LibraryItem[]>;
}
