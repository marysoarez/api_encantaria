// 🚀 Backend completo Node.js + Express + Asaas (SEM Firebase)

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// -----------------------------
// 🔐 CONFIG
// -----------------------------
const ASAAS_API_URL = "https://api-sandbox.asaas.com/v3";
const ASAAS_API_KEY =
  "$aact_hmlg_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OmMxMzFlN2YwLWJkYjgtNDdmNC1iMGZkLTNhMTY0Yjc1Nzk3ZDo6JGFhY2hfODU3MzNlN2MtMDVlZC00Yjk4LTgyNzUtYzliMzViMzE1Zjg5"; // ⚠️ use .env em produção

const asaas = axios.create({
  baseURL: ASAAS_API_URL,
  headers: {
    access_token: ASAAS_API_KEY,
    "Content-Type": "application/json",
  },
});

// -----------------------------
// 🧑‍💼 CRIAR CUSTOMER
// -----------------------------
async function createCustomer({ name, email, cpfCnpj }) {
  const response = await asaas.post("/customers", {
    name,
    email,
    cpfCnpj,
  });

  return response.data.id; // cus_xxxxx
}

// -----------------------------
// 💰 CRIAR PAGAMENTO
// -----------------------------
app.post("/create-payment", async (req, res) => {
  try {
    const {
      billingType, // PIX | CREDIT_CARD
      customerData, // { name, email, cpfCnpj }
      description,
      value,
      installments = 1,
      creditCard,
      creditCardHolderInfo,
    } = req.body;

    console.log("📥 RECEBIDO DO FLUTTER:", req.body);

    // ----------------------------------
    // 1️⃣ Criar cliente no Asaas
    // ----------------------------------
    const customerId = await createCustomer(customerData);

    console.log("🧑‍💼 CUSTOMER ASAAS:", customerId);

    // ----------------------------------
    // 2️⃣ Criar cobrança
    // ----------------------------------
    const paymentPayload = {
      billingType,
      customer: customerId,
      description,
      value: Number(value.toFixed(2)),
      dueDate: new Date(Date.now() + 86400000)
        .toISOString()
        .split("T")[0],
    };

    if (billingType === "CREDIT_CARD") {
      paymentPayload.installmentCount = installments;
    }

    const paymentResponse = await asaas.post(
      "/payments",
      paymentPayload
    );

    const payment = paymentResponse.data;

    console.log("💳 PAGAMENTO CRIADO:", payment.id);

    // ----------------------------------
    // 3️⃣ PAGAR COM CARTÃO (2ª etapa)
    // ----------------------------------
    if (billingType === "CREDIT_CARD") {
      const payResponse = await asaas.post(
        `/payments/${payment.id}/payWithCreditCard`,
        {
          creditCard,
          creditCardHolderInfo,
        }
      );

      console.log("✅ CARTÃO PROCESSADO");

      return res.json({
        success: true,
        paymentId: payment.id,
        status: payResponse.data.status,
      });
    }

    // ----------------------------------
    // 4️⃣ PIX
    // ----------------------------------
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

    res.status(400).json({ error: "Tipo de pagamento inválido" });
  } catch (err) {
    console.error("❌ ERRO CREATE-PAYMENT:", err.response?.data || err);
    res.status(400).json({
      error: err.response?.data || err.toString(),
    });
  }
});

app.get('/pix/:paymentId', async (req, res) => {
  const { paymentId } = req.params;

  try {
    const response = await axios.get(
      `${ASAAS_API_URL}/payments/${paymentId}/pixQrCode`,
      {
        headers: {
          access_token: ASAAS_API_KEY,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ error: 'Erro ao buscar QR Code PIX' });
  }
});


app.post("/confirm-payment", async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({
        error: "paymentId é obrigatório",
      });
    }

    const response = await asaas.get(`/payments/${paymentId}`);
    const payment = response.data;

    console.log("🔎 STATUS ASAAS:", payment.status);

    if (!["CONFIRMED", "RECEIVED"].includes(payment.status)) {
      return res.json({
        status: "pending",
        paymentStatus: payment.status,
      });
    }

    res.json({
      status: "success",
      paymentStatus: payment.status,
      description: payment.description,
      value: payment.value,
    });
  } catch (err) {
    console.error("❌ ERRO CONFIRM-PAYMENT:", err.response?.data || err);
    res.status(500).json({
      error: err.response?.data || err.toString(),
    });
  }
});

// -----------------------------
// ▶ START SERVER
// -----------------------------
app.listen(3333, () => {
  console.log("🚀 Server running at http://localhost:3333");
});
