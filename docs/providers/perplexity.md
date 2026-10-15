# Perplexity (www.perplexity.ai): no adapter

Researched 2026-10-15. Auth is cookies only, and one thread is a GET
(`/rest/thread/{uuid}`), but the thread list is only
`POST /rest/thread/list_ask_threads` with a JSON body, in every source:
[multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py#L50-L60),
[Deplexity](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/types.go#L8-L50),
[hstry](https://github.com/byteowlz/hstry/blob/21d0fd8dec1cc29ae058a303c0d0164e4c1f513d/extension/providers/perplexity.js#L17-L38),
[perplexity-web-mcp](https://github.com/jacob-bd/perplexity-web-mcp/blob/e34b5082d6c16283358d8a1e3cbd7fa61c35fc0d/src/perplexity_web_mcp/core.py#L223-L231).
Confidence: confirmed. Memory is a POST GraphQL persisted query too.

Spaces are a GET (`/rest/collections/list_user_collections`,
`/rest/collections/get_collection?collection_slug=`), but a Perplexity
adapter with Spaces and no threads would mislead, so there is none.
