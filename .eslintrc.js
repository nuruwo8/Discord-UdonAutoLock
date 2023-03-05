module.exports = {
   env: {
      browser: true,
      es2021: true,
      node: true,
   },
   extends: ['standard-with-typescript', 'eslint:recommended', 'prettier'],
   overrides: [],
   parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
   },
   rules: {},
};
