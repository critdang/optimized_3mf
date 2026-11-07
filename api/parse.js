import { createVercelApiHandler } from "../src/web/vercelHandler.js";

export const config = { api: { bodyParser: false } };

export default createVercelApiHandler("inspect");
