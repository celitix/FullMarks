require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

// 1. Initialize app FIRST
const app = express();

// 2. Then apply middleware
app.use(
  cors({
    // origin: "https://localhost:5173",
    origin: "https://app.celitix.com",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "ngrok-skip-browser-warning"],
  }),
);

app.use(express.json());

const PORT = process.env.PORT || 8080;

function normalizePhone(phone) {
  if (!phone) return "";
  const clean = phone.toString().replace(/\D/g, "");
  return clean.length >= 10 ? clean.slice(-10) : clean;
}

async function getShopifyAccessToken() {
  try {
    const url = `${process.env.SHOPIFY_STORE_URL}/admin/oauth/access_token`;
    const payload = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    });

    const response = await axios.post(url, payload.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    return response.data.access_token;
  } catch (error) {
    console.error(
      "Error fetching access token:",
      error.response?.data || error.message,
    );
    throw new Error("Failed to authenticate with Shopify");
  }
}

// ==========================================
// NEW: Home Route (Health Check)
// ==========================================
app.get("/", (req, res) => {
  res.status(200).json({
    statusCode: 200,
    success: true,
    message: "Shopify Bridge Server is up and running.",
  });
});

app.post("/api/order-status", async (req, res) => {
  const { order_number, mobile_number } = req.body;

  if (!order_number || !mobile_number) {
    return res.status(400).json({
      statusCode: 400, // ADDED HERE
      success: false,
      message:
        "Missing parameters. Please provide 'order_number' and 'mobile_number'.",
    });
  }

  try {
    const accessToken = await getShopifyAccessToken();
    const formattedOrderName = order_number.toString().startsWith("#")
      ? order_number
      : `#${order_number}`;

    const shopifyOrderUrl = `${process.env.SHOPIFY_STORE_URL}/admin/api/${process.env.SHOPIFY_API_VERSION}/orders.json?name=${encodeURIComponent(formattedOrderName)}&status=any`;

    const orderResponse = await axios.get(shopifyOrderUrl, {
      headers: { "X-Shopify-Access-Token": accessToken },
    });

    const orders = orderResponse.data.orders;

    if (!orders || orders.length === 0) {
      return res.status(404).json({
        statusCode: 404, // ADDED HERE
        success: false,
        status_type: "NOT_FOUND",
        message: `Order ${formattedOrderName} could not be found.`,
      });
    }

    const order = orders[0];

    const inputPhoneClean = normalizePhone(mobile_number);
    const shippingPhoneClean = normalizePhone(order.shipping_address?.phone);
    const billingPhoneClean = normalizePhone(order.billing_address?.phone);
    const customerPhoneClean = normalizePhone(order.customer?.phone);

    const isPhoneMatch =
      inputPhoneClean === shippingPhoneClean ||
      inputPhoneClean === billingPhoneClean ||
      inputPhoneClean === customerPhoneClean;

    if (!isPhoneMatch) {
      return res.status(403).json({
        statusCode: 403, // ADDED HERE
        success: false,
        status_type: "UNAUTHORIZED",
        message:
          "Phone number verification failed. The phone number does not match this order.",
      });
    }

    const fulfillment =
      order.fulfillments && order.fulfillments.length > 0
        ? order.fulfillments[0]
        : null;

    const responseData = {
      statusCode: 200, // ADDED HERE
      success: true,
      status_type: "SUCCESS",
      customer_name:
        `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim(),
      order_name: order.name,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status || "unfulfilled",
      created_at: order.created_at,
      total_price: `${order.total_price} ${order.currency}`,
      item_summary: order.line_items
        .map((item) => `${item.quantity}x ${item.title}`)
        .join(", "),
      tracking: {
        company: fulfillment ? fulfillment.tracking_company : "Not Available",
        number: fulfillment ? fulfillment.tracking_number : "Not Available",
        url: fulfillment ? fulfillment.tracking_url : "",
      },
    };

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("API Error:", error.message);
    return res.status(500).json({
      statusCode: 500, // ADDED HERE
      success: false,
      status_type: "SERVER_ERROR",
      message:
        "An internal server error occurred while pulling your order details.",
    });
  }
});

// ==========================================
// NEW: 404 Catch-All Route
// (Must be placed after all defined routes)
// ==========================================
app.use((req, res) => {
  res.status(404).json({
    statusCode: 404,
    success: false,
    status_type: "NOT_FOUND",
    message: "The requested route does not exist on this server.",
  });
});

app.listen(PORT, () => {
  console.log(`Bridge Server is up and running on port ${PORT}`);
});
