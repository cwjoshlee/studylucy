import { BlockList, isIP } from "node:net";

const trustedProxyRanges = new BlockList();

trustedProxyRanges.addSubnet("10.0.0.0", 8, "ipv4");
trustedProxyRanges.addSubnet("127.0.0.0", 8, "ipv4");
trustedProxyRanges.addSubnet("169.254.0.0", 16, "ipv4");
trustedProxyRanges.addSubnet("172.16.0.0", 12, "ipv4");
trustedProxyRanges.addSubnet("192.168.0.0", 16, "ipv4");
trustedProxyRanges.addAddress("::1", "ipv6");
trustedProxyRanges.addSubnet("fc00::", 7, "ipv6");
trustedProxyRanges.addSubnet("fe80::", 10, "ipv6");

function normalizeAddress(address: string): string {
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return mappedIpv4?.[1] ?? address;
}

export function trustFirstHopProxy(address: string, hop: number): boolean {
  if (hop !== 0) {
    return false;
  }

  const normalized = normalizeAddress(address);
  const family = isIP(normalized);
  if (family === 4) {
    return trustedProxyRanges.check(normalized, "ipv4");
  }
  if (family === 6) {
    return trustedProxyRanges.check(normalized, "ipv6");
  }
  return false;
}
