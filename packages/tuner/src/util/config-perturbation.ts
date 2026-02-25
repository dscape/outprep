/**
 * Generate config variations for a given parameter.
 *
 * Takes the current best config and a parameter from the registry,
 * and produces a list of config overrides to test.
 */

import type { BotConfig } from "@outprep/engine";
import {
  PARAMETER_REGISTRY,
  getConfigValue,
  buildOverride,
  type TunableParameter,
} from "./parameter-registry";

export interface ConfigVariant {
  parameter: string;
  label: string;
  description: string;
  override: Partial<BotConfig>;
}

/**
 * Generate all variants for a single parameter.
 */
export function generateVariants(
  config: BotConfig,
  param: TunableParameter
): ConfigVariant[] {
  const currentValue = getConfigValue(config, param.path);
  if (currentValue === undefined) {
    console.warn(`  Warning: config path "${param.path}" not found, skipping.`);
    return [];
  }

  return param.perturbations(currentValue).map(({ value, label }) => ({
    parameter: param.path,
    label,
    description: `${param.name}: ${label}`,
    override: buildOverride(param.path, value),
  }));
}

/**
 * Generate all variants for all parameters in the registry,
 * ordered by priority (most impactful first).
 *
 * @param maxTotal - cap the total number of variants returned
 */
export function generateAllVariants(
  config: BotConfig,
  maxTotal?: number
): ConfigVariant[] {
  const sorted = [...PARAMETER_REGISTRY].sort((a, b) => a.priority - b.priority);
  const variants: ConfigVariant[] = [];

  for (const param of sorted) {
    const paramVariants = generateVariants(config, param);
    variants.push(...paramVariants);
    if (maxTotal && variants.length >= maxTotal) {
      return variants.slice(0, maxTotal);
    }
  }

  return maxTotal ? variants.slice(0, maxTotal) : variants;
}
