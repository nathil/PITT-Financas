import { getEnv } from '../config/env';

/**
 * Conjunto em memória para testers adicionados dinamicamente em runtime,
 * somado aos números configurados em TESTER_PHONES no .env.
 */
const runtimeTesterPhones = new Set<string>();

/**
 * Verifica se o identificador do WhatsApp é um grupo, broadcast ou newsletter.
 */
export function isGroupOrBroadcastJid(jidOrPhone: string): boolean {
  const trimmed = jidOrPhone.trim().toLowerCase();
  return (
    trimmed.endsWith('@g.us') ||
    trimmed.endsWith('@broadcast') ||
    trimmed.includes('status@broadcast') ||
    trimmed.endsWith('@newsletter')
  );
}

/**
 * Extrai apenas os dígitos numéricos do telefone a partir de um JID do WhatsApp
 * (ex: "5511999998888:12@s.whatsapp.net" -> "5511999998888") ou número formatado
 * (ex: "+55 (11) 99999-8888" -> "5511999998888").
 */
export function normalizePhone(jidOrPhone: string): string {
  if (!jidOrPhone) return '';
  // Remove sufixo de domínio (@s.whatsapp.net, @c.us, etc.)
  const beforeAt = jidOrPhone.split('@')[0] ?? '';
  // Remove identificador de dispositivo multi-device (:1, :14, etc.)
  const beforeColon = beforeAt.split(':')[0] ?? '';
  // Mantém apenas dígitos
  const digits = beforeColon.replace(/\D/g, '');
  return digits;
}

/**
 * Gera todas as variações equivalentes para números brasileiros (DDI 55 + DDD + 8 ou 9 dígitos)
 * e também sem DDI caso o usuário tenha cadastrado apenas DDD + número no .env.
 */
export function getPhoneVariants(rawPhone: string): string[] {
  const clean = normalizePhone(rawPhone);
  if (!clean) return [];

  const variants = new Set<string>([clean]);

  // Se tiver 10 ou 11 dígitos (sem DDI 55), adiciona versão com 55
  if (clean.length === 10 || clean.length === 11) {
    variants.add(`55${clean}`);
  }

  // Se começar com 55 e tiver 12 ou 13 dígitos (padrão Brasil: 55 + DDD(2) + 8 ou 9 dígitos)
  for (const candidate of Array.from(variants)) {
    if (candidate.startsWith('55') && candidate.length === 13) {
      // 55 + DD + 9 + XXXXXXXX -> também aceita sem o 9 (12 dígitos) e sem o 55
      const ddd = candidate.slice(2, 4);
      const ninth = candidate[4];
      const rest = candidate.slice(5);
      if (ninth === '9') {
        variants.add(`55${ddd}${rest}`);
        variants.add(`${ddd}${rest}`);
      }
      variants.add(`${ddd}${ninth}${rest}`);
    } else if (candidate.startsWith('55') && candidate.length === 12) {
      // 55 + DD + XXXXXXXX -> também aceita com o 9 (13 dígitos) e sem o 55
      const ddd = candidate.slice(2, 4);
      const rest = candidate.slice(4);
      variants.add(`55${ddd}9${rest}`);
      variants.add(`${ddd}9${rest}`);
      variants.add(`${ddd}${rest}`);
    }
  }

  return Array.from(variants);
}

/**
 * Converte um telefone brasileiro para sua forma canônica de 13 dígitos (55 + DDD + 9 + 8 dígitos)
 * quando aplicável, para salvar de maneira uniforme no banco de dados.
 */
export function toCanonicalPhone(jidOrPhone: string): string {
  const clean = normalizePhone(jidOrPhone);
  if (!clean) return '';

  if (clean.length === 11) {
    return `55${clean}`;
  }
  if (clean.length === 10) {
    const ddd = clean.slice(0, 2);
    const rest = clean.slice(2);
    return `55${ddd}9${rest}`;
  }
  if (clean.startsWith('55') && clean.length === 12) {
    const ddd = clean.slice(2, 4);
    const rest = clean.slice(4);
    return `55${ddd}9${rest}`;
  }
  return clean;
}

/**
 * Retorna a lista de telefones de testers configurados via .env + runtime.
 */
export function getConfiguredTesterPhones(): string[] {
  const env = getEnv();
  const envList = env.TESTER_PHONES.split(/[,;\s]+/)
    .map((p) => normalizePhone(p))
    .filter(Boolean);

  const combined = new Set<string>([...envList, ...runtimeTesterPhones]);
  return Array.from(combined);
}

/**
 * Adiciona um número de telefone à lista de testers em tempo de execução.
 */
export function addTesterPhone(phone: string): string {
  const canonical = toCanonicalPhone(phone);
  if (canonical) {
    runtimeTesterPhones.add(canonical);
  }
  return canonical;
}

/**
 * Remove um número de telefone da lista dinâmica de testers.
 */
export function removeTesterPhone(phone: string): void {
  for (const variant of getPhoneVariants(phone)) {
    runtimeTesterPhones.delete(variant);
  }
}

/**
 * Limpa os testers adicionados em runtime (útil para testes).
 */
export function clearRuntimeTesters(): void {
  runtimeTesterPhones.clear();
}

/**
 * Verifica se um remetente (JID ou telefone) tem permissão de Tester.
 * - Ignora grupos, broadcasts e números vazios.
 * - Quando STRICT_TESTER_ONLY=true (padrão), exige que o número pertença à lista de testers.
 */
export function isAllowedTester(
  jidOrPhone: string,
  extraAllowedPhones: string[] = []
): boolean {
  if (!jidOrPhone || isGroupOrBroadcastJid(jidOrPhone)) {
    return false;
  }

  const incomingVariants = getPhoneVariants(jidOrPhone);
  if (incomingVariants.length === 0) {
    return false;
  }

  const env = getEnv();
  if (!env.STRICT_TESTER_ONLY) {
    return true;
  }

  const allowedRaw = [...getConfiguredTesterPhones(), ...extraAllowedPhones];
  const allowedVariantSet = new Set<string>();
  for (const raw of allowedRaw) {
    for (const v of getPhoneVariants(raw)) {
      allowedVariantSet.add(v);
    }
  }

  return incomingVariants.some((v) => allowedVariantSet.has(v));
}
