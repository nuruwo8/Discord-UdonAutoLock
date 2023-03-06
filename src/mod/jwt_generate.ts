import * as jwt from 'jsonwebtoken';
import * as path from 'node:path';
import * as fs from 'node:fs';

//------------------------define jwt Keys-------------------------
const privateKey = fs.readFileSync(path.resolve('settings', 'private', 'jwt') + '/private_key.pem');
const publicKey = fs.readFileSync(path.resolve('settings', 'private', 'jwt') + '/public_key.pem').toString();

//------------------------define jwt token generate functions-------------------------
export function getJwtToken(dataHash: string, exp: number): string {
   const nowUnixTime = Math.trunc(Date.now() / 1000);
   // hash for anti tamper
   const payload = {
      dataHash,
      iat: nowUnixTime,
   };
   const jwtOptions: jwt.SignOptions = {
      expiresIn: exp, //expiresIn unit is seconds.
      algorithm: 'RS256',
   };
   //generate jwt token
   const token = jwt.sign(payload, privateKey, jwtOptions);
   return token;
}

export function getPublicKey(): string {
   return publicKey;
}
