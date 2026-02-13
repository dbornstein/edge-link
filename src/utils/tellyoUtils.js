const TELLYO_DEFAULT_CHUNK = 0;
const PORT_MIN = 10006;
const PORT_MAX = 10100;

/**
 * Helper: Extract the port number from a standard SRT URL.
 * Example: "srt://1.2.3.4:10006" -> 10006
 * Handles URLs with or without query parameters or trailing slashes.
 */
const extractPort = (url) => {
  if (!url || typeof url !== 'string') return null;
  // Match :digits that is either at the end of string OR followed by ? or /
  const match = url.match(/:(\d+)(?:$|[/?])/);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Helper: Calculate the next available SRT port or retrieve the existing one.
 * 
 * Strategy:
 * 1. If we are editing an existing channel (currentChannelId provided), try to reuse its current port.
 * 2. If it's a new channel, scan all existing channels to find used ports.
 * 3. Pick the next highest available port within the PORT_MIN - PORT_MAX range.
 * 4. If the range is exhausted, wrap around to PORT_MIN.
 * 
 * @param {string} videonIp - The public IP of the Videon device.
 * @param {Array} existingChannels - List of current Tellyo channels.
 * @param {string|null} currentChannelId - ID of the channel being edited (if any).
 */
const getSrtUrl = (videonIp, existingChannels, currentChannelId) => {
  if (!videonIp) return ''; // Cannot build URL without a valid IP address

  // 1. If this is an EDIT (currentChannelId is present), try to keep the old port
  if (currentChannelId) {
    const currentChannel = existingChannels.find(c => c.id === currentChannelId);
    if (currentChannel && currentChannel.streamUrl) {
      const existingPort = extractPort(currentChannel.streamUrl);
      if (existingPort) return `srt://${videonIp}:${existingPort}`;
    }
  }

  // 2. If NEW (or old port not found), find the highest used port in range
  const usedPorts = existingChannels
    .map(c => extractPort(c.streamUrl))
    .filter(p => p !== null && p >= PORT_MIN && p < PORT_MAX);

  const nextPort = usedPorts.length > 0 ? Math.max(...usedPorts) + 1 : PORT_MIN;

  if (nextPort > PORT_MAX) {
    // If range full, fallback to random within range or just throw. 
    // For now, let's wrap around to min.
    return `srt://${videonIp}:${PORT_MIN}`;
  }

  return `srt://${videonIp}:${nextPort}`;
};

/**
 * Constructs the payload object required by the Tellyo API to create or update a channel.
 * 
 * @param {Object} profile - The user's input profile (containing name, encoder settings, etc.).
 * @param {Object} config - The Tellyo-specific configuration from the profile (streamUrl, profile name, etc.).
 * @param {string} videonIp - The device's public IP address.
 * @param {Array} existingChannels - List of existing channels to check for port conflicts.
 * @param {string|null} channelId - The ID of the channel if updating, or null if creating new.
 */
export const buildTellyoChannelPayload = (profile, config, videonIp, existingChannels = [], channelId = null) => {
  // 1. Handle Chunk Length Defaulting
  const chunkLength = config.chunkLength === '' 
    ? TELLYO_DEFAULT_CHUNK 
    : parseInt(config.chunkLength, 10) || TELLYO_DEFAULT_CHUNK;

  if (!config.profile) {
    throw new Error("Tellyo Profile Name is required. Please set it in the Inputs profile.");
  }

  // 2. Determine Stream URL
  // If user typed one manually, use it. Otherwise, auto-generate based on device IP and next available port.
  let finalStreamUrl = config.streamUrl;
  if (!finalStreamUrl || finalStreamUrl.trim() === '') {
    finalStreamUrl = getSrtUrl(videonIp, existingChannels, channelId);
  }

  // 3. Construct the Payload
  const payload = {
    name: config.channelName,
    profile: config.profile,
    chunkLength,
    streamUrl: finalStreamUrl,
    startDataCollectionWithRecording: !!config.startDataCollection,
  };

  // 4. Handle Time Logic (Ensure Integer)
  // Tellyo expects 'twentyFourStartTime' as a unix timestamp (seconds) if recording is enabled.
  const ts = Number(config.twentyFourStartTime);
  const isValidTs = Number.isFinite(ts) && ts > 0;

  if (payload.startDataCollectionWithRecording) {
    // Current time in seconds if no specific start time provided
    payload.twentyFourStartTime = isValidTs ? Math.floor(ts) : Math.floor(Date.now() / 1000);
  } else if (isValidTs) {
    payload.twentyFourStartTime = Math.floor(ts);
  }

  return payload;
};

export const tellyoChannelEndpoint = (info, channelId = '') => {
  if (!info.orgId) throw new Error('Set the Tellyo organization ID in Settings.');
  
  // Stricter check for edit vs add
  const isEdit = !!channelId && channelId !== '0' && channelId !== 'new';
  
  const toNumericOrg = (id) => parseInt(id, 10);
  const orgNumeric = typeof info.orgIdNumeric === 'number' ? info.orgIdNumeric : toNumericOrg(info.orgId);

  if (info.version === 'v1' || orgNumeric == null) {
    const baseV1 = info.baseV1 || info.base;
    return { url: `${baseV1}/channel/${isEdit ? 'edit' : 'add'}`, method: 'POST' };
  }

  const suffix = isEdit ? `/${channelId}` : '';
  const basePath = `${info.baseV2}/organizations/${orgNumeric}/channels${suffix}`;
  
  return { url: basePath, method: isEdit ? 'PUT' : 'POST' };
};