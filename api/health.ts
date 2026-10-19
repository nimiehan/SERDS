export default function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    status: "ok",
    backend: "express",
    platform: "Vercel Serverless Function",
    timestamp: new Date().toISOString(),
    aimlApiActive: Boolean(process.env.AIMLAPI_KEY),
    aimlModel: "google/gemma-3-4b-it",
    geminiActive: Boolean(process.env.GEMINI_API_KEY)
  });
}
