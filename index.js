require("dotenv").config();
const express = require("express");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const multer = require("multer");
const qrcode = require("qrcode");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for handling file uploads
const upload = multer({ storage: multer.memoryStorage() });

const port = 8080;
let qrCode = "";
let clientReady = false;

// Middleware to validate API key
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey && apiKey === process.env.APIKEY) {
    next(); // Valid API key, proceed to the next middleware or route handler
  } else {
    res
      .status(403)
      .json({ status: "error", message: "Forbidden: Invalid API key" });
  }
};

// Initialize WhatsApp client with persistent session
// const client = new Client({
//   authStrategy: new LocalAuth(),
// });
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("QR RECEIVED");
  qrCode = qr;
});

client.on("ready", () => {
  console.log("Client is ready!");
  clientReady = true;
  qrCode = ""; // Clear QR code when connected
});

client.on("authenticated", () => {
  console.log("Client authenticated!");
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failed", msg);
});

client.on("disconnected", (reason) => {
  console.log("Client disconnected", reason);
  clientReady = false;
  qrCode = ""; // Reset QR code
  client.destroy();
  client.initialize(); // Reinitialize for new QR code
});

client.initialize();

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// Unified API for sending messages/files
app.post(
  "/api/send",
  validateApiKey,
  upload.array("files"),
  async (req, res) => {
    const { group, groupName, number, message, caption } = req.body;
    const files = req.files;
    console.log(req.body, "body");

    try {
      if (group === "true") {
        const chats = await client.getChats();
        const groupChat = chats.find(
          (chat) =>
            chat.id.server === "g.us" &&
            chat.name.toLowerCase() === groupName.toLowerCase()
        );

        if (!groupChat) {
          return res
            .status(404)
            .json({ status: "error", message: "Group not found" });
        }

        if (files && files.length > 0) {
          for (const file of files) {
            const media = new MessageMedia(
              file.mimetype,
              file.buffer.toString("base64"),
              file.originalname
            );
            await client.sendMessage(groupChat.id._serialized, media, {
              caption: caption || "",
            });
          }
        }
        if (message) {
          await client.sendMessage(groupChat.id._serialized, message);
        }
      } else {
        if (!number) {
          return res
            .status(400)
            .json({ status: "error", message: "Number is required" });
        }

        if (files && files.length > 0) {
          for (const file of files) {
            const media = new MessageMedia(
              file.mimetype,
              file.buffer.toString("base64"),
              file.originalname
            );
            await client.sendMessage(`91${number}@c.us`, media, {
              caption: caption || "",
            });
          }
        }
        if (message) {
          await client.sendMessage(`91${number}@c.us`, message);
        }
      }

      res.json({ status: "success", message: "Message sent successfully" });
    } catch (error) {
      console.error("Error sending message:", error);
      res
        .status(500)
        .json({ status: "error", message: "Failed to send message" });
    }
  }
);

// API to get QR code or status
app.get("/api/status", async (req, res) => {
  if (clientReady) {
    res.json({ status: "success", message: "Client is ready!" });
  } else if (qrCode) {
    try {
      const qrUrl = await qrcode.toDataURL(qrCode);
      res.json({ status: "waiting", qr: qrUrl });
    } catch (err) {
      res
        .status(500)
        .json({ status: "error", message: "Failed to generate QR code" });
    }
  } else {
    res.json({ status: "disconnected", message: "Client is disconnected" });
  }
});

// API to logout
app.post("/api/logout", async (req, res) => {
  try {
    if (clientReady) {
      await client.logout();
    }
    clientReady = false;
    qrCode = "";
    client.initialize();
    res.json({ status: "success", message: "Logged out successfully" });
  } catch (error) {
    console.error("Error logging out:", error);
    res.status(500).json({ status: "error", message: "Failed to log out" });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
