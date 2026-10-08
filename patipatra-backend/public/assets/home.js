import { chrome } from "/assets/site.js";

const settings = await chrome("/");
const quote = document.getElementById("quote");
if (settings?.home_quote_bn) quote.textContent = settings.home_quote_bn;
