import path from 'path';
import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';

const options: BuildOptions = {
   entryPoints: [path.resolve(__dirname, '../src/main.ts')],
   minify: false,
   bundle: true,
   target: 'ESNext',
   platform: 'node',
   external: ['@prisma/client', 'prisma'],
   outfile: path.resolve(__dirname, '../.build/main.js'),
};

build(options).catch((err) => {
   process.stderr.write(err.stderr);
   process.exit(1);
});
