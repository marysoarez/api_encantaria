// 🚀 Backend completo Node.js + Express + Asaas + WhatsApp Business
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(cors());
app.use(bodyParser.json());

/* ======================================================
 🔐 CONFIG ASAAS
====================================================== */
const ASAAS_API_URL = "https://api-sandbox.asaas.com/v3";
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

const asaas = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    access_token: ASAAS_API_KEY,
    "Content-Type": "application/json",
  },
});

/* ======================================================
 📲 CONFIG WHATSAPP
====================================================== */
const whatsapp = axios.create({
  baseURL: "https://graph.facebook.com/v22.0",
  headers: {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  },
});


/* ======================================================
 📲 FUNÇÃO WHATSAPP (ROBUSTA)
====================================================== */
async function sendWhatsAppMessage({ phone, message }) {
  try {
    // fallback de segurança (DEV)
    let rawPhone = phone ?? "11999999999";

    // normaliza para string e remove tudo que não é número
    let normalizedPhone = String(rawPhone).replace(/\D/g, "");

    // força DDI 55
    if (!normalizedPhone.startsWith("55")) {
      normalizedPhone = `55${normalizedPhone}`;
    }

    // valida tamanho mínimo (55 + DDD + número)
    if (normalizedPhone.length < 12) {
      console.warn(
        "⚠️ Telefone inválido, WhatsApp ignorado:",
        normalizedPhone
      );
      return;
    }

    await whatsapp.post(
      `/${process.env.WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: normalizedPhone,
        type: "text",
        text: { body: message },
      }
    );

    console.log("📲 WhatsApp enviado para", normalizedPhone);
  } catch (error) {
    // nunca derruba pagamento
    console.error(
      "❌ ERRO WHATSAPP:",
      error.response?.data || error.message
    );
  }
}

/* ======================================================
 📝 MENSAGEM CONFIRMAÇÃO
====================================================== */
function buildConfirmationMessage({ name, service, value }) {
  return `
✅ *Pagamento confirmado!*

Olá, ${name} 😊  
Seu pagamento foi confirmado com sucesso.

🛎 Serviço: ${service}
💰 Valor: R$ ${value}

Qualquer dúvida é só responder essa mensagem 💬
`;
}

/* ======================================================
 🧑‍💼 CRIAR CUSTOMER
====================================================== */
async function createCustomer({ name, email, cpfCnpj }) {
  const response = await asaas.post("/customers", {
    name,
    email,
    cpfCnpj,
  });

  return response.data.id;
}

/* ======================================================
 💰 CRIAR PAGAMENTO
====================================================== */
app.post("/create-payment", async (req, res) => {
  try {
    const {
      billingType,
      customerData, // { name, email, cpfCnpj, phone }
      description,
      value,
      creditCard,
      creditCardHolderInfo,
    } = req.body;

    const numericValue = Number(value);
    if (isNaN(numericValue)) {
      throw new Error("Valor inválido");
    }

    const customerId = await createCustomer(customerData);

    const paymentPayload = {
      billingType,
      customer: customerId,
      description,
      value: Number(numericValue.toFixed(2)),
      dueDate: new Date(Date.now() + 86400000)
        .toISOString()
        .split("T")[0],
    };

    if (billingType === "CREDIT_CARD") {
      paymentPayload.installmentCount = 1;
      paymentPayload.installmentValue = Number(
        numericValue.toFixed(2)
      );
    }

    const { data: payment } = await asaas.post(
      "/payments",
      paymentPayload
    );

    /* -----------------------------
       💳 CARTÃO
    ------------------------------ */
    if (billingType === "CREDIT_CARD") {
      const payResponse = await asaas.post(
        `/payments/${payment.id}/payWithCreditCard`,
        { creditCard, creditCardHolderInfo }
      );

      // WhatsApp NÃO bloqueia retorno
      sendWhatsAppMessage({
        phone: customerData?.phone,
        message: buildConfirmationMessage({
          name: customerData.name,
          service: description,
          value: numericValue.toFixed(2),
        }),
      });

      return res.json({
        success: true,
        paymentId: payment.id,
        status: payResponse.data.status,
      });
    }

    /* -----------------------------
       💠 PIX
    ------------------------------ */
    if (billingType === "PIX") {
      return res.json({
        success: true,
        paymentId: payment.id,
        status: payment.status,
        pixQrCode:
          payment.pixTransaction?.qrCode?.payload ?? null,
        pixImage:
          payment.pixTransaction?.qrCode?.encodedImage ?? null,
      });
    }

    res.status(400).json({ error: "Tipo inválido" });
  } catch (err) {
    console.error("❌ ERRO CREATE-PAYMENT:", err.message);
    res.status(400).json({ error: err.message });
  }
});

/* ======================================================
 💠 CONFIRMAR PIX + WHATSAPP
====================================================== */
app.post("/confirm-payment", async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res
        .status(400)
        .json({ error: "paymentId obrigatório" });
    }

    const { data: payment } = await asaas.get(
      `/payments/${paymentId}`
    );

    if (!["CONFIRMED", "RECEIVED"].includes(payment.status)) {
      return res.json({
        status: "pending",
        paymentStatus: payment.status,
      });
    }

    // WhatsApp após confirmação PIX (telefone fixo por enquanto)
    sendWhatsAppMessage({
      phone: "11999999999",
      message: buildConfirmationMessage({
        name: "Cliente",
        service: payment.description,
        value: payment.value,
      }),
    });

    res.json({
      status: "success",
      paymentStatus: payment.status,
    });
  } catch (err) {
    console.error("❌ ERRO CONFIRM-PAYMENT:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ======================================================
 ❤️ HEALTH CHECK
====================================================== */
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

/* ======================================================
 ▶ START SERVER
====================================================== */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server rodando na porta ${PORT}`);
});
