// src/api/mockData.js

export const demoDevices = () => [
  { device_guid: "edge-tx-a23", serial_number: "Edge-TX-A23", display_name: "Edge TX A23" },
  { device_guid: "edge-tx-b17", serial_number: "Edge-TX-B17", display_name: "Edge TX B17" },
  { device_guid: "edge-tx-east", serial_number: "Edge-TX-East", display_name: "Edge TX East" },
];

export const demoOutputsShadow = () => [
  { Outputs: { list: [
    { output_id: 1, name: "primary", type: "srt", enabled: true },
    { output_id: 2, name: "backup", type: "srt", enabled: false },
  ] } }
];

export const demoAllAlerts = (ids = []) =>
  ids.flatMap((id, i) => [{
    alert_guid: `demo-${i}-1`, device_guid: id, timestamp: new Date(Date.now() - (i + 1) * 6e4).toISOString(),
    alert_type: "State", name: "Device Offline", label: "offline", silenced: false
  }]);