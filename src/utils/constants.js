// src/utils/constants.js

export const VIDEO_CODECS = ["h264", "hevc"];
export const AUDIO_CODECS = ["aac", "opus"];
export const RESOS = [
  { label: "1080p59.94", w: 1920, h: 1080, fps: 59.94 },
  { label: "1080p60", w: 1920, h: 1080, fps: 60 },
  { label: "720p60", w: 1280, h: 720, fps: 60 },
];
export const ENC_MODES = ["CBR", "VBR"];
export const KF_UNITS = ["frames", "seconds"];
export const QA_LAT = ["Quality priority", "Latency priority"];
export const OUTPUT_TARGETS = ["Tellyo Studio", "Amagi CLOUDPORT"];

export const CLOUDPORT_COMPUTE = ["medium", "high"];
export const CLOUDPORT_PROTOCOLS = ["udp", "rtp"];
export const CLOUDPORT_STREAM_MODES = ["ts", "tr07"];

export const TELLYO_DEFAULT_CHUNK = 0;

export const defaultCloudportConfig = () => ({
  ingestLabel: "",
  flowName: "primary",
  computeProfile: "medium",
  streamUrl: "",
  protocol: "udp",
  streamMode: "ts",
  headStart: 11.9,
  elicDelay: 6.8,
  pcrPid: 256,
  enableStreamParsing: true,
  record: false,
  alwaysOn: false,
  includeLowRes: true,
  includeData: false,
  dataCodec: "scte",
  dataMode: "",
});

export const defaultTellyoConfig = () => ({
  channelName: "",
  profile: "",
  chunkLength: TELLYO_DEFAULT_CHUNK,
  startDataCollection: false,
  twentyFourStartTime: '',
  streamUrl: "",
});