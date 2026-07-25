# Docker

The root `docker-compose.yml` starts keepmind Server beta with a persistent Valkey sidecar.

```sh
docker compose up --build
curl http://127.0.0.1:37777/healthz
```

The server container uses:

- `KEEPMIND_WORKER_HOST=0.0.0.0`
- `KEEPMIND_DATA_DIR=/data/keepmind`
- `KEEPMIND_QUEUE_ENGINE=bullmq`
- `KEEPMIND_REDIS_URL=redis://valkey:6379`
- `KEEPMIND_AUTH_MODE=api-key`

Create an API key inside the container before using protected V1 write routes.
