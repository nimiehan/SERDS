export interface TriageAssessmentResult {
  urgency: 'P1_CRITICAL' | 'P2_URGENT' | 'P3_MODERATE' | 'P4_NON_URGENT';
  urgencyLabel: string;
  chiefComplaint: string;
  dispatchNeeded: boolean;
  recommendedService?: 'ambulance' | 'police' | 'fire';
  dispatchLabel?: string;
  firstAidSteps: string[];
  precautions?: string[];
}

export interface RuleBasedTriageResult {
  text: string;
  guidance: string;
  triage: TriageAssessmentResult;
}

export function getRuleBasedEmergencyTriage(userQuery: string, context?: any): RuleBasedTriageResult {
  const q = (userQuery || "").toLowerCase();

  if (q.includes("fire") || q.includes("smoke") || q.includes("burning") || q.includes("explosion") || q.includes("flame")) {
    return {
      text: "Structure/hazard fire reported. Evacuate immediately to an open outdoor assembly area. Do not use elevators.\n\n1. Evacuate all occupants to designated safety assembly point.\n2. Keep low beneath smoke to reduce inhalation.\n3. Do not re-enter the building for personal items.\n\n[ACTION: Dispatch Fire & Rescue]",
      guidance: "Structure/hazard fire reported. Evacuate immediately to an open outdoor assembly area. Do not use elevators.",
      triage: {
        urgency: "P1_CRITICAL",
        urgencyLabel: "P1 - Critical",
        chiefComplaint: "Active Structure Fire / Smoke Inhalation",
        dispatchNeeded: true,
        recommendedService: "fire",
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

  if (q.includes("police") || q.includes("robber") || q.includes("thief") || q.includes("intruder") || q.includes("weapon") || q.includes("gun") || q.includes("attack") || q.includes("assault") || q.includes("stalk") || q.includes("break-in") || q.includes("danger") || q.includes("fight")) {
    return {
      text: "Active security hazard reported. Move to a secure, locked shelter immediately. Silence mobile audio and stay quiet.\n\n1. Lock entry doors, windows, and find concealed cover.\n2. Silence device ringtones and avoid silhouette near windows.\n3. Keep phone close for direct tactical messaging.\n\n[ACTION: Dispatch Police]",
      guidance: "Active security hazard reported. Move to a secure, locked shelter immediately. Silence mobile audio and stay quiet.",
      triage: {
        urgency: "P1_CRITICAL",
        urgencyLabel: "P1 - Critical",
        chiefComplaint: "Immediate Security Threat / Active Crime",
        dispatchNeeded: true,
        recommendedService: "police",
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
        urgency: "P1_CRITICAL",
        urgencyLabel: "P1 - Critical",
        chiefComplaint: "Acute Medical Emergency",
        dispatchNeeded: true,
        recommendedService: "ambulance",
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
      urgency: "P2_URGENT",
      urgencyLabel: "P2 - Urgent",
      chiefComplaint: "Emergency Triage Assessment",
      dispatchNeeded: true,
      recommendedService: "ambulance",
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
