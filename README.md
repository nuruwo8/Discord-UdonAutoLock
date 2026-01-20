# Udon Auto Lock (Discord bot)

This is the Discord bot program of Udon Auto Lock.

https://booth.pm/ja/items/4590105

You can use your own bot in this repository.
The bot runs on Node.js.

### Setup Cloudflare R2

You need to create two R2 buckets in Cloudflare:

1. **VRC Public Bucket** - For VRChat World token (public access)
   - Set up a public domain for this bucket. Purchasing the domain through Cloudflare Registrar is recommended for easier management.
2. **Backup Private Bucket** - For backup data (private access)
   - By default, backups are created every 7 hours. It is recommended to configure "Object lifecycle rules" in R2 settings to automatically delete old backups after a certain period (e.g., 30 days) to optimize storage.

> [!NOTE]
> R2 is a pay-as-you-go service.

### Set Environments

Please obtain the required tokens from each service in advance.

> [!NOTE]
> R2 API tokens require read and write permissions.

- Make ".env" file in root directory. See ".env.example" and below.
   - `R2_VRC_BASE_URL`

      Set the public custom domain assigned to your VRC public bucket.

   - `R2_BOT_SEPARATE_PATH`

      This is used to prevent conflicts when sharing the same R2 bucket across multiple bots. Set a unique arbitrary string for each bot. If you only run one bot, you can use the value from `.env.example` as-is.

   - `CDN_ZONE_ID` & `CDN_PURGE_API_KEY`

      Required to purge the cache when tokens are updated. Without purging, updated token values will not be reflected.

   - `DISCORD_TOKEN`

      Set your discord bot token string.
      Discord bot requires SERVER MEMBERS INTENT.

      ![image](/documents/images/bot_intent.png)

### Project launch

- `git clone [GitHub URL]` to get this code.
- `yarn` to get packages.
- `yarn make_jwt_keys` to create RSA key pair for JSON Web Token.

> [!NOTE]
> Requires OpenSSL library.

- `yarn generate_db` to generate new database by prisma.

> [!NOTE]
> This will delete old database and recreate the database.

#### Run (development)

- `yarn dev` to launch typescript code.

#### Build and run (production)

- `yarn build` to compile typescript code to javascript.
- `yarn start` to launch javascript code.
