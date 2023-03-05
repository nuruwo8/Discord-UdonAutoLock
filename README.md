# Udon Auto Lock (discord bot)

This is the Discord bot program of Udon Auto Lock.
Run on Node.js.

### Project launch

-  `git clone [GitHub URL]` to get this code.
-  `yarn` to get packages.
-  `yarn make_jwt_keys` create RSA key pair for Json Web Token
   _Note: need OpenSSL library._
-  `yarn make_db` to make database by prisma.
   _Note: that this will delete and recreate the database._

### Project settings

-  Make Setting files. You have to make 3 file.

   -  `settings/private/firebase-secret.json`

      Get your Secret key of Firebase Admin SDK and rename file.
      Also you have to make Bucket of Firebase storage.
      _Note:Please be aware of pay-as-you-go charges for using Firebase._

   -  `settings/private/discord_token.txt`

      Just write your discord bot token string.

   -  `settings/setting.json`

      please refer `settings/setting.json.example`.

      It is OK if the file structure is like this

      ![image](/documents/settingsPath.png)

#### Run (development)

-  `yarn dev` to launch typescript code.

#### Build and run (production)

-  `yarn compile` to compile typescript code to javascript.
-  `yarn launch` to launch javascript code.
