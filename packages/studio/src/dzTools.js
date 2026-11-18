// DZ: Tools — single-purpose studios on the same adaptive engine as Create.
// Each tool is a filter over the catalog (which endpoints belong to it) plus
// its own words for the media slots. No React here.

export const TOOLS = [
  {
    id: "lipsync",
    title: "Lip Sync",
    text: "Make the person in a video say new words: a video plus a voice track.",
    kind: "video",
    match: /lip-?sync/i,
    labels: { source: "Video", audio: "Voice", first: "Photo" },
    main: ["sync_mode", "mode", "resolution"],
    promptLabel: "Notes for the model (optional)",
  },
  {
    id: "motion",
    title: "Motion Control",
    text: "Your character moves exactly like the person in a reference video.",
    kind: "video",
    match: /motion-control|animate-move/i,
    labels: { first: "Character", source: "Motion video", video: "Motion video" },
    main: ["character_orientation", "mode", "resolution"],
    promptLabel: "Describe the scene (optional)",
  },
  {
    id: "avatar",
    title: "Talking Photo",
    text: "A portrait and a voice track become a talking video.",
    kind: "video",
    match: /avatar/i,
    labels: { first: "Photo", audio: "Voice", reference: "Background" },
    main: ["avatar", "voice", "mode", "resolution"],
    promptLabel: "What the person does or says",
  },
  {
    id: "swap",
    title: "Character Swap",
    text: "Replace the person in a video with your character; motion and scene stay.",
    kind: "video",
    match: /animate-mix|character-swap/i,
    labels: { first: "New character", source: "Video" },
    main: ["mode", "resolution"],
    promptLabel: "Notes for the model (optional)",
  },
  {
    id: "audio",
    title: "Audio",
    text: "Voice-over in many voices and languages, or a whole song from a description.",
    kind: "audio",
    match: null,
    labels: {},
    main: ["voice", "voice_id", "language", "language_boost", "emotion", "instrumental", "is_instrumental", "vocal_gender"],
    promptLabel: "Text to speak, or a description of the music",
  },
];

export const toolById = (id) => TOOLS.find((t) => t.id === id) || null;
