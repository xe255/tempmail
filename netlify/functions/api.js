const serverless = require("serverless-http");
const app = require("../../server");

let initialized = false;
const rawHandler = serverless(app);

exports.handler = async (event, context) => {
  if (!initialized) {
    initialized = true;
    await app.init();
  }
  return rawHandler(event, context);
};
