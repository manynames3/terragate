const API_ORIGIN = "https://hwnk8hnyk1.execute-api.us-east-1.amazonaws.com";

const proxy = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/v1/")) return env.WEB.fetch(request);
    // Fixed upstream: never let request data choose a proxy destination.
    const upstream = new URL(API_ORIGIN);
    upstream.pathname = url.pathname;
    upstream.search = url.search;
    const forwarded = new Request(upstream, request);
    forwarded.headers.delete("cookie");
    forwarded.headers.delete("origin");
    forwarded.headers.delete("referer");
    const response = await fetch(forwarded, { redirect: "manual" });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.delete("set-cookie");
    return new Response(response.body, { status: response.status, headers });
  }
};

export default proxy;
