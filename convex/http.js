// Convex backend: HTTP routes.
// Docs: https://docs.convex.dev/functions/http
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/hello",
  method: "GET",
  handler: httpAction(async () => {
    return new Response("Hello from Convex!", { status: 200 });
  }),
});

export default http;
