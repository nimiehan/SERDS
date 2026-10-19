import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createServer as createHttpServer } from "http";
import { Server } from "socket.io";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const httpServer = createHttpServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Initialize Gemini AI Client on the server side
  const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      })
    : null;

  // Active Online Responders Registry
  interface OnlineResponder {
    id: string;
    socketId?: string;
    callSign: string;
    apparatus: "ambulance" | "police" | "fire";
    status: "waiting" | "en_route" | "on_scene" | "transporting" | "offline";
    coords: [number, number];
    accuracy?: number;
    phone?: string;
    lastSeen: number;
    isStationStandby?: boolean;
  }

  const onlineResponders: Map<string, OnlineResponder> = new Map();

  function getActiveRespondersList(refCoords?: [number, number]): OnlineResponder[] {
    const now = Date.now();
    const active: OnlineResponder[] = [];
    for (const [id, r] of onlineResponders.entries()) {
      // Retain responder for up to 10 minutes (600,000ms) between heartbeats for mobile/background stability
      if (now - r.lastSeen <= 600000 && r.status !== 'offline') {
        let coords = r.coords;
        if ((!coords || (coords[0] === 0 && coords[1] === 0)) && refCoords && refCoords[0] !== 0) {
          coords = [refCoords[0] + 0.005, refCoords[1] + 0.005];
        } else if (!coords || (coords[0] === 0 && coords[1] === 0)) {
          coords = [14.5995, 120.9842];
        }
        active.push({ ...r, coords });
      } else if (now - r.lastSeen > 900000) {
        onlineResponders.delete(id);
      }
    }
    return active;
  }

  // Socket.io Real-time Presence & Tactical Messaging
  io.on("connection", (socket) => {
    // Send immediate fleet sync upon connection
    socket.emit("responders-sync", getActiveRespondersList());

    // Responder registers presence & live GPS coordinates
    socket.on("responder-presence", (data) => {
      const respId = data.id || `resp-${data.apparatus || 'unit'}`;
      const responder: OnlineResponder = {
        id: respId,
        socketId: socket.id,
        callSign: data.callSign || (data.apparatus === 'police' ? 'Patrol Cruiser' : data.apparatus === 'fire' ? 'Rescue Engine' : 'Medic Squad'),
        apparatus: data.apparatus || "ambulance",
        status: data.status || "waiting",
        coords: data.coords || [0, 0],
        accuracy: data.accuracy,
        phone: data.phone || "",
        lastSeen: Date.now()
      };
      onlineResponders.set(respId, responder);
      io.emit("responders-sync", getActiveRespondersList());
    });

    // Real-time two-way tactical incident messaging
    socket.on("send-incident-message", (data) => {
      if (data && data.incidentId) {
        if (!incidentMessages[data.incidentId]) incidentMessages[data.incidentId] = [];
        const msg = {
          id: data.message?.id || "msg-" + Date.now(),
          sender: data.message?.sender || "citizen",
          senderName: data.message?.senderName || "User",
          text: data.message?.text || "",
          timestamp: data.message?.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isUrgent: Boolean(data.message?.isUrgent)
        };
        incidentMessages[data.incidentId].push(msg);
        io.emit("incident-message", { incidentId: data.incidentId, message: msg });
      }
    });

    socket.on("disconnect", () => {
      // Retain responder in presence registry with grace period; emit current active list
      io.emit("responders-sync", getActiveRespondersList());
    });
  });

  // Middlewares
  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Active Incidents Store
  interface Incident {
    id: string;
    code: string;
    type: string;
    priority: "critical" | "urgent" | "standard";
    location: string;
    reportedTime: string;
    patientName: string;
    recommendedUnit: string;
    service?: "ambulance" | "police" | "fire";
    targetResponderId?: string;
    acceptedUnit?: string;
    acceptedUnitId?: string;
    declinedBy?: string[];
    distanceKm: number;
    etaMins: number;
    routeAlgorithm: string;
    status: "pending" | "dispatched" | "en_route" | "on_scene" | "cancelled" | "completed";
    coords: [number, number];
    details?: string;
    createdAt: string;
    isGeneralSos?: boolean;
  }

  function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // meters
    const p1 = (lat1 * Math.PI) / 180;
    const p2 = (lat2 * Math.PI) / 180;
    const deltaP = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(deltaP / 2) * Math.sin(deltaP / 2) +
      Math.cos(p1) * Math.cos(p2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  const liveIncidents: Incident[] = [];

  // Incident Comms / Chat Messages Store
  const incidentMessages: Record<string, Array<{ id: string; sender: string; senderName: string; text: string; timestamp: string; isUrgent?: boolean }>> = {};

  // 1. Health Endpoint
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      backend: "express",
      platform: "Node.js Express / Vite",
      timestamp: new Date().toISOString(),
      activeIncidents: liveIncidents.length,
      serverUptimeSec: Math.floor(process.uptime()),
      serviceStatus: "ONLINE",
      aimlApiActive: Boolean(process.env.AIMLAPI_KEY),
      aimlModel: "google/gemma-3-4b-it",
      geminiAiActive: Boolean(ai)
    });
  });

  // 2. Incident Management Endpoints
  app.get("/api/incidents", (_req, res) => {
    res.json({
      success: true,
      count: liveIncidents.length,
      data: liveIncidents
    });
  });

  app.post("/api/incidents", (req, res) => {
    const { id, type, location, priority, patientName, coords, details, service, targetResponderId, recommendedUnit, isGeneralSos } = req.body;
    const activeFleet = getActiveRespondersList(coords && coords[0] ? coords : undefined);

    // Reject dispatch if no responders are currently online and no explicit unit was targeted
    if (activeFleet.length === 0 && !targetResponderId && !recommendedUnit) {
      res.status(400).json({
        success: false,
        message: "No emergency responders are currently online. Cannot dispatch.",
        noResponders: true
      });
      return;
    }

    const newId = id || `INC-${Math.floor(1000 + Math.random() * 9000)}`;
    const isSos = Boolean(isGeneralSos || type?.toLowerCase().includes("sos") || type?.toLowerCase().includes("general"));
    
    let resolvedService: "ambulance" | "police" | "fire" = service || "ambulance";
    let resolvedTargetResponderId = targetResponderId;
    let resolvedRecommendedUnit = recommendedUnit;

    if (isSos) {
      // Home screen SOS button activated: dispatch the nearest unit of ANY service
      const sortedFleet = [...activeFleet].sort((a, b) => {
        if (!coords || !coords[0]) return 0;
        const da = calculateDistance(coords[0], coords[1], a.coords[0], a.coords[1]);
        const db = calculateDistance(coords[0], coords[1], b.coords[0], b.coords[1]);
        return da - db;
      });

      const nearestUnit = sortedFleet[0];
      resolvedService = nearestUnit.apparatus;
      resolvedTargetResponderId = targetResponderId || nearestUnit.id;
      resolvedRecommendedUnit = recommendedUnit || nearestUnit.callSign;
    } else {
      // Map screen or specific service dispatch: only the selected/specified responder
      if (service) {
        resolvedService = service;
      } else if (type?.toLowerCase().includes("police")) {
        resolvedService = "police";
      } else if (type?.toLowerCase().includes("fire")) {
        resolvedService = "fire";
      }

      if (!resolvedTargetResponderId) {
        // Find matching units in the chosen service
        const serviceUnits = activeFleet.filter(r => r.apparatus === resolvedService);
        if (serviceUnits.length > 0) {
          if (coords && coords[0]) {
            serviceUnits.sort((a, b) => {
              const da = calculateDistance(coords[0], coords[1], a.coords[0], a.coords[1]);
              const db = calculateDistance(coords[0], coords[1], b.coords[0], b.coords[1]);
              return da - db;
            });
          }
          resolvedTargetResponderId = serviceUnits[0].id;
          resolvedRecommendedUnit = serviceUnits[0].callSign;
        }
      } else {
        const found = activeFleet.find(r => r.id === resolvedTargetResponderId);
        if (found) {
          resolvedRecommendedUnit = found.callSign;
          resolvedService = found.apparatus;
        }
      }
    }

    const defaultUnitName = resolvedRecommendedUnit || (
      resolvedService === "police" ? "Police Emergency Unit" :
      resolvedService === "fire" ? "Fire & Rescue Unit" : "EMS Paramedic Unit"
    );

    const newIncident: Incident = {
      id: newId,
      code: "10-79",
      type: type || (isSos ? "Emergency SOS Alert" : `Emergency Dispatch Alert (${resolvedService.toUpperCase()})`),
      priority: priority || "critical",
      location: location || "GPS Location Reported",
      reportedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      patientName: patientName || "Citizen Caller",
      service: resolvedService,
      targetResponderId: resolvedTargetResponderId || undefined,
      recommendedUnit: defaultUnitName,
      distanceKm: 0,
      etaMins: 0,
      routeAlgorithm: "OSRM Road Network / Dijkstra",
      status: "dispatched",
      coords: coords || [0, 0],
      details: details || "",
      declinedBy: [],
      createdAt: new Date().toISOString(),
      isGeneralSos: isSos
    };

    liveIncidents.unshift(newIncident);

    // Broadcast only to targeted responder (or to fleet with target filter) via WebSockets
    io.emit("incoming-call", {
      citizenId: newId,
      id: newId,
      callerName: newIncident.patientName,
      location: newIncident.location,
      type: newIncident.type,
      service: newIncident.service,
      targetResponderId: newIncident.targetResponderId,
      recommendedUnit: newIncident.recommendedUnit,
      isGeneralSos: newIncident.isGeneralSos
    });

    io.emit("incident-dispatched", newIncident);

    res.status(201).json({
      success: true,
      message: "Emergency incident dispatched successfully",
      data: newIncident
    });
  });

  app.get("/api/incidents/:id", (req, res) => {
    const item = liveIncidents.find(i => i.id === req.params.id);
    if (!item) {
      res.status(404).json({ success: false, message: "Incident not found" });
      return;
    }
    res.json({ success: true, data: item });
  });

  app.patch("/api/incidents/:id/status", (req, res) => {
    const { status, acceptedUnit, acceptedUnitId, coords, apparatus } = req.body;
    const item = liveIncidents.find(i => i.id === req.params.id);
    if (!item) {
      // Broadcast update even if created via direct Firestore fallback
      io.emit("incident-updated", { id: req.params.id, status });
      if (status === 'en_route') {
        io.emit("incident-accepted", {
          incidentId: req.params.id,
          status: 'en_route',
          responder: {
            id: acceptedUnitId || "responder",
            callSign: acceptedUnit || "Assigned Unit",
            apparatus: apparatus || "ambulance",
            coords: coords || [0, 0]
          }
        });
      }
      res.json({ success: true, data: { id: req.params.id, status } });
      return;
    }

    if (status) {
      item.status = status;
      if (status === 'en_route') {
        item.acceptedUnit = acceptedUnit || item.acceptedUnit || item.recommendedUnit;
        item.acceptedUnitId = acceptedUnitId || item.acceptedUnitId || item.targetResponderId;
        
        io.emit("incident-accepted", {
          incidentId: item.id,
          status: 'en_route',
          responder: {
            id: item.acceptedUnitId || "unit",
            callSign: item.acceptedUnit || item.recommendedUnit,
            apparatus: item.service || apparatus || "ambulance",
            coords: coords || item.coords
          }
        });
      }
      io.emit("incident-updated", item);
    }
    res.json({ success: true, data: item });
  });

  // Decline incident:
  // Decline incident:
  // - If General SOS from Home screen: cascade to next nearest unit of ANY service
  // - If specific service from Map screen: cascade to next unit in the SAME service
  // - If no units remain: trigger emergency 911 auto-call
  app.post("/api/incidents/:id/decline", (req, res) => {
    const { responderId, callSign, apparatus, availableResponders } = req.body;
    let item = liveIncidents.find(i => i.id === req.params.id || i.code === req.params.id);
    if (!item) {
      // Find the most recent dispatched or pending incident, or synthesize one
      item = liveIncidents.find(i => i.status === 'dispatched' || i.status === 'pending');
      if (!item) {
        item = {
          id: req.params.id,
          code: "10-79",
          type: `Emergency Dispatch (${apparatus || 'ambulance'})`,
          priority: "critical",
          location: "GPS Location Reported",
          reportedTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          patientName: "Citizen Caller",
          service: apparatus || "ambulance",
          recommendedUnit: callSign || "Unit",
          distanceKm: 0,
          etaMins: 0,
          routeAlgorithm: "OSRM Road Network",
          status: "dispatched",
          coords: [14.5995, 120.9842],
          declinedBy: [],
          createdAt: new Date().toISOString(),
          isGeneralSos: false
        };
        liveIncidents.unshift(item);
      }
    }

    item.declinedBy = item.declinedBy || [];
    if (responderId && !item.declinedBy.includes(responderId)) {
      item.declinedBy.push(responderId);
    }
    if (callSign && !item.declinedBy.includes(callSign)) {
      item.declinedBy.push(callSign);
    }

    // Combine server online fleet and any available responders sent in body
    const serverFleet = getActiveRespondersList(item.coords && item.coords[0] ? item.coords : undefined);
    const clientFleet: OnlineResponder[] = Array.isArray(availableResponders) ? availableResponders : [];
    const combinedFleetMap = new Map<string, OnlineResponder>();
    serverFleet.forEach(r => combinedFleetMap.set(r.id, r));
    clientFleet.forEach(r => {
      if (r && r.id && !combinedFleetMap.has(r.id)) {
        combinedFleetMap.set(r.id, {
          id: r.id,
          callSign: r.callSign,
          apparatus: r.apparatus,
          status: r.status,
          coords: r.coords || [14.5995, 120.9842],
          lastSeen: Date.now()
        });
      }
    });
    const fleet = Array.from(combinedFleetMap.values());

    const isGeneralSos = Boolean(item.isGeneralSos);
    const serviceType = item.service || apparatus || "ambulance";
    const previousUnitName = callSign || responderId || "Previous Unit";

    // Helper to check if a responder has already declined
    const hasDeclined = (r: OnlineResponder) => {
      return item!.declinedBy!.some(d => 
        String(d).toLowerCase() === String(r.id).toLowerCase() ||
        String(d).toLowerCase() === String(r.callSign).toLowerCase()
      );
    };

    let candidateUnits: OnlineResponder[] = [];
    if (isGeneralSos) {
      // Home Screen SOS: cascade to next nearest unit of ANY service
      candidateUnits = fleet.filter(r => r.status !== 'offline' && !hasDeclined(r));
    } else {
      // Specific Service Incident (MapScreen): cascade to next unit in the SAME SERVICE
      candidateUnits = fleet.filter(r => r.apparatus === serviceType && r.status !== 'offline' && !hasDeclined(r));
    }

    // Sort candidate units by distance to citizen coordinates if available
    if (candidateUnits.length > 1 && item.coords && item.coords[0]) {
      candidateUnits.sort((a, b) => {
        const da = calculateDistance(item!.coords[0], item!.coords[1], a.coords[0], a.coords[1]);
        const db = calculateDistance(item!.coords[0], item!.coords[1], b.coords[0], b.coords[1]);
        return da - db;
      });
    }

    if (candidateUnits.length > 0) {
      const nextUnit = candidateUnits[0];
      item.recommendedUnit = nextUnit.callSign;
      item.targetResponderId = nextUnit.id;
      item.service = nextUnit.apparatus;
      item.status = "dispatched";

      // 1. Notify citizen: unit declined & transitioning to next unit
      io.emit("incident-declined", {
        incidentId: item.id,
        declinedBy: previousUnitName,
        service: nextUnit.apparatus,
        nextUnit: {
          id: nextUnit.id,
          callSign: nextUnit.callSign,
          apparatus: nextUnit.apparatus,
          coords: nextUnit.coords,
          status: nextUnit.status
        },
        allDeclined: false,
        isGeneralSos
      });

      // 2. Emit incident-reassigned event
      io.emit("incident-reassigned", {
        incidentId: item.id,
        previousUnit: previousUnitName,
        nextUnit: {
          id: nextUnit.id,
          callSign: nextUnit.callSign,
          apparatus: nextUnit.apparatus,
          coords: nextUnit.coords,
          status: nextUnit.status
        },
        service: nextUnit.apparatus,
        isGeneralSos
      });

      // 3. Ring the next responder!
      io.emit("incoming-call", {
        citizenId: item.id,
        id: item.id,
        callerName: item.patientName,
        location: item.location,
        type: item.type,
        service: nextUnit.apparatus,
        targetResponderId: nextUnit.id,
        recommendedUnit: nextUnit.callSign,
        isGeneralSos
      });

      io.emit("incident-updated", item);

      res.json({
        success: true,
        message: `Incident auto-reassigned to next available unit: ${nextUnit.callSign}`,
        reassignedTo: nextUnit,
        allDeclined: false,
        isGeneralSos
      });
    } else {
      // No units left of this type: trigger 911 call!
      item.status = "cancelled";

      io.emit("incident-declined", {
        incidentId: item.id,
        declinedBy: previousUnitName,
        service: serviceType,
        allDeclined: true,
        call911: true,
        isGeneralSos
      });

      io.emit("incident-declined-all", {
        incidentId: item.id,
        service: serviceType,
        isGeneralSos,
        call911: true,
        declinedBy: previousUnitName
      });

      io.emit("incident-updated", item);

      res.json({
        success: true,
        message: `All available ${serviceType} units have declined. Calling 911.`,
        allDeclined: true,
        call911: true
      });
    }
  });

  // Incident Comms / Chat Messages Store
  app.get("/api/incidents/:id/messages", (req, res) => {
    const list = incidentMessages[req.params.id] || [];
    res.json({ success: true, data: list });
  });

  app.post("/api/incidents/:id/messages", (req, res) => {
    const { sender, senderName, text, isUrgent } = req.body;
    if (!incidentMessages[req.params.id]) {
      incidentMessages[req.params.id] = [];
    }
    const newMsg = {
      id: "msg-" + Date.now(),
      sender: sender || "responder",
      senderName: senderName || "Responder",
      text: text || "",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isUrgent: Boolean(isUrgent)
    };
    incidentMessages[req.params.id].push(newMsg);
    io.emit("incident-message", { incidentId: req.params.id, message: newMsg });
    res.status(201).json({ success: true, data: newMsg });
  });

  // Direct Messenger Comms (Direct Citizen <-> Responder Chat)
  app.post("/api/direct-chats/message", (req, res) => {
    const { chatId, message, chat } = req.body;
    io.emit("direct-message", { chatId, message, chat });
    res.json({ success: true });
  });

  // Guaranteed Emergency Triage Helper (prevents Serdy from ever being offline or useless)
  function getRuleBasedEmergencyTriage(userQuery: string, context?: any) {
    const q = (userQuery || "").toLowerCase();
    
    if (q.includes("fire") || q.includes("smoke") || q.includes("burning") || q.includes("explosion") || q.includes("flame")) {
      return {
        text: "Structure/hazard fire reported. Evacuate immediately to an open outdoor assembly area. Do not use elevators.\n\n1. Evacuate all occupants to designated safety assembly point.\n2. Keep low beneath smoke to reduce inhalation.\n3. Do not re-enter the building for personal items.\n\n[ACTION: Dispatch Fire & Rescue]",
        guidance: "Structure/hazard fire reported. Evacuate immediately to an open outdoor assembly area. Do not use elevators.",
        triage: {
          urgency: "P1_CRITICAL" as const,
          urgencyLabel: "P1 - Critical",
          chiefComplaint: "Active Structure Fire / Smoke Inhalation",
          dispatchNeeded: true,
          recommendedService: "fire" as const,
          dispatchLabel: "Dispatch Fire & Rescue",
          firstAidSteps: [
            "Evacuate everyone to open exterior area immediately.",
            "Stay low to the floor beneath smoke layer.",
            "Check closed doors with back of hand before opening."
          ],
          precautions: ["Never use elevators during a structural fire.", "Do not re-enter for personal belongings."]
        }
      };
    }

    if (q.includes("police") || q.includes("robber") || q.includes("thief") || q.includes("intruder") || q.includes("weapon") || q.includes("gun") || q.includes("attack") || q.includes("assault") || q.includes("stalk") || q.includes("break-in") || q.includes("danger")) {
      return {
        text: "Active security hazard reported. Move to a secure, locked shelter immediately. Silence mobile audio and stay quiet.\n\n1. Lock entry doors, windows, and find concealed cover.\n2. Silence device ringtones and avoid silhouette near windows.\n3. Keep phone close for direct tactical messaging.\n\n[ACTION: Dispatch Police]",
        guidance: "Active security hazard reported. Move to a secure, locked shelter immediately. Silence mobile audio and stay quiet.",
        triage: {
          urgency: "P1_CRITICAL" as const,
          urgencyLabel: "P1 - Critical",
          chiefComplaint: "Immediate Security Threat / Active Crime",
          dispatchNeeded: true,
          recommendedService: "police" as const,
          dispatchLabel: "Dispatch Police",
          firstAidSteps: [
            "Lock all doors and take concealed cover.",
            "Silence mobile device ringtones and vibrations.",
            "Observe suspect descriptions only if safe to do so."
          ],
          precautions: ["Do not attempt to confront armed or aggressive individuals."]
        }
      };
    }

    if (q.includes("chest") || q.includes("heart") || q.includes("breath") || q.includes("stroke") || q.includes("unconscious") || q.includes("seizure") || q.includes("bleed") || q.includes("blood") || q.includes("fracture") || q.includes("pain") || q.includes("burn") || q.includes("chok") || q.includes("allerg") || q.includes("faint") || q.includes("dizzi") || q.includes("wound") || q.includes("hurt") || q.includes("collapsed")) {
      return {
        text: "Medical emergency assessment initiated. Immediate paramedic evaluation is recommended.\n\n1. Keep the patient resting comfortably in an upright or recovery position.\n2. Loosen constrictive clothing around the neck and chest.\n3. If active bleeding is present, apply firm, direct pressure with a clean cloth.\n4. Monitor pulse and respirations continuously.\n\n[ACTION: Dispatch Ambulance]",
        guidance: "Medical emergency assessment initiated. Immediate paramedic evaluation is recommended.",
        triage: {
          urgency: "P1_CRITICAL" as const,
          urgencyLabel: "P1 - Critical",
          chiefComplaint: "Acute Medical Emergency",
          dispatchNeeded: true,
          recommendedService: "ambulance" as const,
          dispatchLabel: "Dispatch Ambulance",
          firstAidSteps: [
            "Keep patient seated comfortably or in recovery position.",
            "Apply direct, steady pressure to any active wounds.",
            "Loosen tight clothing to assist breathing.",
            "Do not give oral fluids or solid food."
          ],
          precautions: context?.allergies?.length ? [`Patient allergies on file: ${context.allergies.join(", ")}`] : []
        }
      };
    }

    return {
      text: "Serdy is online and actively monitoring your emergency report. If you are experiencing pain, acute trauma, smoke, fire, or immediate threat, please tap the dispatch button to alert emergency services.\n\n1. Confirm you are in a safe physical position.\n2. Keep your device on and accessible.\n3. Provide any specific symptoms or immediate hazards.\n\n[ACTION: Dispatch Ambulance]",
      guidance: "Serdy is online and actively monitoring your emergency report. If you are experiencing pain, acute trauma, smoke, fire, or immediate threat, please tap the dispatch button to alert emergency services.",
      triage: {
        urgency: "P2_URGENT" as const,
        urgencyLabel: "P2 - Urgent",
        chiefComplaint: "Emergency Triage Assessment",
        dispatchNeeded: true,
        recommendedService: "ambulance" as const,
        dispatchLabel: "Dispatch Ambulance",
        firstAidSteps: [
          "Confirm immediate physical safety.",
          "Keep your line open and mobile phone accessible.",
          "Specify detailed symptoms if conscious."
        ],
        precautions: []
      }
    };
  }

  // 3. Server-Side AI Chat & Emergency Triage Assistant (AIMLAPI google/gemma-3-4b-it + Gemini fallback)
  app.post("/api/chat", async (req, res) => {
    const { messages, context } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ success: false, error: "Messages array is required." });
      return;
    }

    const aimlApiKey = process.env.AIMLAPI_KEY;

    const userContextSnippet = context ? `
User Context:
- Caller Name: ${context.callerName || "Unknown"}
- Address / Location: ${context.location || "Not specified"}
- Blood Type: ${context.bloodType || "Unknown"}
- Known Allergies: ${Array.isArray(context.allergies) && context.allergies.length > 0 ? context.allergies.join(", ") : "None reported"}
` : "";

    const systemInstruction = `You are Serdy, the clinical Smart Emergency Response Dispatch (SERD) AI triage assistant powered by google/gemma-3-4b-it.
Your mission is to rapidly evaluate emergency situations, triage severity using universal emergency triage standards (P1 Critical through P4 Non-Urgent), give clear step-by-step life preservation instructions, and determine required emergency services.

Triage Standards:
- P1_CRITICAL: Immediate life threat (respiratory failure, cardiac arrest, severe hemorrhage, unconsciousness, stroke, major trauma, active structure fire, violent assault).
- P2_URGENT: Serious condition requiring rapid dispatch (fractures with pulse, controlled deep laceration, head trauma with consciousness, smoke inhalation).
- P3_MODERATE: Non-life-threatening medical or minor security issues (minor burns, sprains, stable symptoms).
- P4_NON_URGENT: General first-aid questions or minor conditions that do not require emergency dispatch.

Rules:
1. Speak in a calm, decisive, reassuring tone.
2. If dispatch is needed, designate the correct service: 'ambulance', 'police', or 'fire'.
3. Always provide concrete, numbered, immediate first-aid actions (e.g. "1. Apply firm, direct pressure...", "2. Keep patient lying down...").
4. Check caller known allergies and situation risks for safety precautions.
5. If situation is minor or self-limiting, reassure the user and state self-care guidelines without false alarm.
6. If emergency dispatch is needed, include the action tag at the very end in this exact format:
[ACTION: Dispatch Ambulance] OR [ACTION: Dispatch Police] OR [ACTION: Dispatch Fire & Rescue]
${userContextSnippet}`;

    // Priority 1: Use AIMLAPI with google/gemma-3-4b-it if AIMLAPI_KEY is configured
    if (aimlApiKey) {
      try {
        // Filter out any initial greeting bot messages so conversation starts with user
        const firstUserIndex = messages.findIndex((m: any) => m.role === 'user');
        const relevantHistory = firstUserIndex !== -1 ? messages.slice(firstUserIndex) : messages;

        const aimlMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

        for (let i = 0; i < relevantHistory.length; i++) {
          const m = relevantHistory[i];
          const isUser = !(m.role === 'bot' || m.role === 'model' || m.role === 'assistant');
          const role: 'user' | 'assistant' = isUser ? 'user' : 'assistant';
          let content = String(m.text || m.content || '').trim();

          // Embed system instruction into the initial user prompt (Gemma 3 only accepts 'user' | 'assistant')
          if (i === 0 && role === 'user') {
            content = `${systemInstruction}\n\n[Emergency Caller]:\n${content}`;
          }

          // Merge adjacent same-role messages to guarantee strict alternating turns
          if (aimlMessages.length > 0 && aimlMessages[aimlMessages.length - 1].role === role) {
            aimlMessages[aimlMessages.length - 1].content += `\n${content}`;
          } else {
            aimlMessages.push({ role, content });
          }
        }

        // Guarantee at least one user message
        if (aimlMessages.length === 0) {
          aimlMessages.push({
            role: 'user',
            content: `${systemInstruction}\n\n[Emergency Caller]:\nHello, I need emergency triage assistance.`
          });
        }

        const r = await fetch("https://api.aimlapi.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${aimlApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemma-3-4b-it",
            messages: aimlMessages,
          }),
        });

        if (!r.ok) {
          const errText = await r.text();
          console.error("[AIMLAPI] Error response from API:", r.status, errText);
          throw new Error(`AIMLAPI responded with status ${r.status}: ${errText}`);
        }

        const data: any = await r.json();
        const replyContent: string = data.choices?.[0]?.message?.content || "";

        // Parse action tag and clean guidance
        const actionMatch = replyContent.match(/\[ACTION:\s*([^\]]+)\]/i);
        const actionLabel = actionMatch ? actionMatch[1].trim() : undefined;
        const cleanText = replyContent.replace(/\[ACTION:\s*([^\]]+)\]/i, '').trim();

        let recService: 'ambulance' | 'police' | 'fire' | undefined = undefined;
        if (actionLabel) {
          const lower = actionLabel.toLowerCase();
          if (lower.includes('police')) recService = 'police';
          else if (lower.includes('fire')) recService = 'fire';
          else if (lower.includes('ambulance') || lower.includes('medic') || lower.includes('ems')) recService = 'ambulance';
        }

        let urgency: 'P1_CRITICAL' | 'P2_URGENT' | 'P3_MODERATE' | 'P4_NON_URGENT' = 'P3_MODERATE';
        let urgencyLabel = 'P3 - Moderate';
        const contentLower = replyContent.toLowerCase();
        if (contentLower.includes('p1') || contentLower.includes('critical') || contentLower.includes('life-threatening') || contentLower.includes('cardiac') || contentLower.includes('unconscious')) {
          urgency = 'P1_CRITICAL';
          urgencyLabel = 'P1 - Critical';
        } else if (contentLower.includes('p2') || contentLower.includes('urgent') || contentLower.includes('fracture') || contentLower.includes('deep laceration')) {
          urgency = 'P2_URGENT';
          urgencyLabel = 'P2 - Urgent';
        } else if (contentLower.includes('p4') || contentLower.includes('non-urgent') || contentLower.includes('minor')) {
          urgency = 'P4_NON_URGENT';
          urgencyLabel = 'P4 - Non-Urgent';
        }

        const stepMatches = cleanText.match(/(?:^|\n)\s*(\d+[\.\)]\s*[^\n]+)/g);
        const firstAidSteps = stepMatches ? stepMatches.map(s => s.trim().replace(/^\d+[\.\)]\s*/, '')) : [];

        res.json({
          success: true,
          text: replyContent,
          guidance: cleanText,
          model: "google/gemma-3-4b-it",
          provider: "aimlapi",
          triage: actionLabel ? {
            urgency,
            urgencyLabel,
            chiefComplaint: "Emergency Assessment",
            dispatchNeeded: true,
            recommendedService: recService,
            dispatchLabel: actionLabel,
            firstAidSteps,
            precautions: []
          } : undefined
        });
        return;
      } catch (aimlErr: any) {
        console.warn("[AIMLAPI] Request failed, checking fallback:", aimlErr.message);
        if (!ai) {
          res.status(502).json({
            success: false,
            error: aimlErr.message,
            text: "Error communicating with AIMLAPI google/gemma-3-4b-it. Please check your AIMLAPI_KEY secret."
          });
          return;
        }
        // Fall back to Gemini if available
      }
    }

    // Priority 2 / Fallback: Google Gemini API
    if (ai) {
      try {
        const contents = messages.map((m: any) => ({
          role: m.role === 'bot' || m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.text }]
        }));

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents,
          config: {
            systemInstruction,
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                guidance: {
                  type: Type.STRING,
                  description: "Conversational, calm, professional guidance from Serdy to the caller."
                },
                urgency: {
                  type: Type.STRING,
                  description: "One of: P1_CRITICAL, P2_URGENT, P3_MODERATE, P4_NON_URGENT"
                },
                urgencyLabel: {
                  type: Type.STRING,
                  description: "Short human label: e.g. 'P1 - Critical', 'P2 - Urgent', 'P3 - Moderate', 'P4 - Non-Urgent'"
                },
                chiefComplaint: {
                  type: Type.STRING,
                  description: "Concise emergency summary (e.g. 'Acute Chest Pain', 'Severe Bleeding', 'Residential Fire')"
                },
                dispatchNeeded: {
                  type: Type.BOOLEAN,
                  description: "True if emergency unit dispatch is needed"
                },
                recommendedService: {
                  type: Type.STRING,
                  description: "One of: 'ambulance', 'police', 'fire', 'none'"
                },
                dispatchLabel: {
                  type: Type.STRING,
                  description: "Button label, e.g. 'Dispatch Ambulance', 'Dispatch Police', 'Dispatch Fire & Rescue'"
                },
                firstAidSteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Ordered, concrete first aid steps for the user to follow right now."
                },
                precautions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "Crucial clinical precautions, allergy warnings, or environmental hazards."
                }
              },
              required: ["guidance", "urgency", "urgencyLabel", "chiefComplaint", "dispatchNeeded", "recommendedService", "firstAidSteps"]
            }
          }
        });

        let parsed: any = null;
        try {
          parsed = JSON.parse(response.text || "{}");
        } catch (parseErr) {
          console.warn("[Gemini API] Failed to parse triage JSON, using text fallback:", parseErr);
        }

        if (parsed && parsed.guidance) {
          let combinedText = parsed.guidance;
          if (parsed.dispatchNeeded && parsed.dispatchLabel) {
            combinedText += `\n\n[ACTION: ${parsed.dispatchLabel}]`;
          }

          res.json({
            success: true,
            text: combinedText,
            guidance: parsed.guidance,
            provider: "gemini",
            triage: {
              urgency: parsed.urgency,
              urgencyLabel: parsed.urgencyLabel,
              chiefComplaint: parsed.chiefComplaint,
              dispatchNeeded: parsed.dispatchNeeded,
              recommendedService: parsed.recommendedService === 'none' ? undefined : parsed.recommendedService,
              dispatchLabel: parsed.dispatchLabel,
              firstAidSteps: parsed.firstAidSteps || [],
              precautions: parsed.precautions || []
            }
          });
          return;
        }

        const fallbackText = response.text || "I have received your situation details. Please remain safe.";
        res.json({
          success: true,
          text: fallbackText,
          provider: "gemini"
        });
        return;
      } catch (err: any) {
        console.warn("[Gemini API] Chat triage notice:", err?.message || err);
      }
    }

    // Priority 3 / Guaranteed Clinical Fallback: Rule-based emergency triage engine
    // Ensures Serdy is never disabled or useless even if network or API keys fail
    const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user')?.text || '';
    const fallbackTriage = getRuleBasedEmergencyTriage(lastUserMessage, context);

    res.json({
      success: true,
      text: fallbackTriage.text,
      guidance: fallbackTriage.guidance,
      provider: "clinical-triage-engine",
      triage: fallbackTriage.triage
    });
  });



  // 5. Real-time Emergency Units Telemetry & Online Responders
  app.get("/api/responders/online", (req, res) => {
    const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
    const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
    const refCoords = (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) ? [lat, lng] as [number, number] : undefined;
    const list = getActiveRespondersList(refCoords);
    res.json({
      success: true,
      count: list.length,
      data: list
    });
  });

  app.post("/api/responders/presence", (req, res) => {
    const data = req.body;
    const respId = data.id || `resp-${data.apparatus || 'unit'}`;
    const responder: OnlineResponder = {
      id: respId,
      socketId: data.socketId || 'http-client',
      callSign: data.callSign || (data.apparatus === 'police' ? 'Patrol Cruiser' : data.apparatus === 'fire' ? 'Rescue Engine' : 'Medic Squad'),
      apparatus: data.apparatus || 'ambulance',
      status: data.status || 'waiting',
      coords: data.coords || [0, 0],
      accuracy: data.accuracy,
      phone: data.phone || '',
      lastSeen: Date.now()
    };
    onlineResponders.set(respId, responder);
    io.emit("responders-sync", getActiveRespondersList());
    res.json({ success: true, data: responder });
  });

  app.get("/api/telemetry/units", (req, res) => {
    const units = getActiveRespondersList().map(r => ({
      id: r.id,
      name: r.callSign,
      type: r.apparatus,
      status: r.status,
      coords: r.coords
    }));
    res.json({
      success: true,
      units
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true' ? { server: httpServer } : false
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
