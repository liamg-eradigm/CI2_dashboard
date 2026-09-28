# Containerised SingleFile capture service

SingleFile needs a full browser runtime with script injection and a writable
filesystem. A Cloudflare Worker provides neither, so — as 2_Input_Architecture
requires — this capture step runs in a **separate container** while the public
application stays on Cloudflare.

```
apps/capture (Worker, CAPTURE_MODE=container) ──HTTPS + Bearer token──▶ this container ──▶ filtering egress proxy ──▶ internet
```

## Isolation
- No database, storage or application secrets are available in the container.
- Unprivileged user, fresh temporary browser profile per capture, no cookies kept.
- Page scripts are blocked in the saved output (`--block-scripts`); the capture
  worker then scans and sanitises the HTML again before anything is stored.
- Limits: 20 s page load, 30 s job, 10 MB snapshot.
- Route egress through a filtering proxy that blocks private, loopback,
  link-local/metadata, CGNAT and multicast ranges (e.g. [Stripe Smokescreen](https://github.com/stripe/smokescreen))
  and set `EGRESS_PROXY=http://smokescreen:4750`. Also deny egress at the
  network layer except to the proxy.

## Run
```bash
docker build -t eradigm-capture services/capture-container
docker run --rm -p 8080:8080 -e CONTAINER_TOKEN="$(openssl rand -hex 32)" -e EGRESS_PROXY=http://smokescreen:4750 eradigm-capture
```
Deploy on any container platform (Cloudflare Containers, Cloud Run, Azure
Container Apps, ECS…). Then on the capture worker:

```bash
npx wrangler secret put CONTAINER_TOKEN --env production -c apps/capture/wrangler.jsonc
# set CAPTURE_MODE=container and CONTAINER_URL=https://<container host> in apps/capture/wrangler.jsonc
```

The capture worker still validates the URL and every DNS answer before calling
the container and re-validates the final URL afterwards.
