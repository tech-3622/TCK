# TCK Treasury

TCK Treasury is a pnpm workspace containing the web application, API server, shared API contracts, and database schema.

## Run in Replit

Install workspace dependencies with `pnpm install`, then start the existing `API Server` and `web` workflows.

The API uses PostgreSQL through `DATABASE_URL`. Apply the development schema with:

```sh
pnpm --filter @workspace/db run push
```

Private document and payment-proof uploads use Replit App Storage. Configure the storage environment through Replit's Secrets tooling before enabling uploads.

## Accounts

The first account registered in a fresh database is the administrator. Create that account before sharing a published app. Members use `/login`; administrators use `/admin/login`. There are no built-in usernames or passwords.

The source ZIP does not include database records, uploaded documents, secrets, or installed dependencies.
