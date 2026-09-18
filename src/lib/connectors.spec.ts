//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ConnectorConfig } from "@microsoft/rayfin-connectors";
import { connectorConfigs, connectorNameFromPath, connectorRuntimes, wireConnectors } from "@/lib/connectors";

const semanticModel = { connector: "fabric-semanticmodel" } as unknown as ConnectorConfig;

describe("connectorNameFromPath", () => {
    it("takes the directory name the CLI scaffolded", () => {
        expect(connectorNameFromPath("../../rayfin/connectors/salesModel/schema.ts")).toBe("salesModel");
        expect(connectorNameFromPath("/abs/rayfin/connectors/eyReport/schema.ts")).toBe("eyReport");
    });

    it("returns nothing rather than a wrong name when the path has no directory", () => {
        expect(connectorNameFromPath("schema.ts")).toBe("");
    });
});

describe("wireConnectors", () => {
    it("wires a scaffolded connector without editing this file", () => {
        const configs = wireConnectors({
            "../../rayfin/connectors/salesModel/schema.ts": { connectorConfig: semanticModel },
        });
        expect(Object.keys(configs)).toEqual(["salesModel"]);
    });

    it("wires several connectors deterministically", () => {
        const configs = wireConnectors({
            "../../rayfin/connectors/zulu/schema.ts": { connectorConfig: semanticModel },
            "../../rayfin/connectors/alpha/schema.ts": { connectorConfig: semanticModel },
        });
        expect(Object.keys(configs)).toEqual(["alpha", "zulu"]);
    });

    it("is empty for a template with no connectors, and does not throw", () => {
        expect(wireConnectors({})).toEqual({});
    });

    it("throws when a scaffolded module has no connectorConfig, naming the fix", () => {
        expect(() => wireConnectors({
            "../../rayfin/connectors/stale/schema.ts": {},
        })).toThrowError(/stale\/schema\.ts does not export `connectorConfig`.*rayfin connector add/s);
    });

    it("throws on a connector type this app's schema cannot describe", () => {
        const kusto = { connector: "kusto" } as unknown as ConnectorConfig;
        expect(() => wireConnectors({
            "../../rayfin/connectors/events/schema.ts": { connectorConfig: kusto },
        })).toThrowError(/"events" is of type "kusto".*AppConnectorsSchema/s);
    });

    it("refuses a path it cannot read a name from instead of registering an empty key", () => {
        expect(() => wireConnectors({
            "schema.ts": { connectorConfig: semanticModel },
        })).toThrowError(/Could not read a connector name/);
    });
});

describe("the shipped template", () => {
    it("starts with no connectors wired, so a fresh app builds and runs", () => {
        expect(connectorConfigs).toEqual({});
        expect(connectorRuntimes).toEqual({});
    });

    it("keeps the config and runtime maps in step", () => {
        expect(Object.keys(connectorRuntimes)).toEqual(Object.keys(connectorConfigs));
    });
});

// ── The eval harness rewrites this file, and its contract is textual ──
//
// `packages/harness-core/src/rayfin/connector-semantic-model-patch.ts` swaps the
// real runtime for a capture broker so the app can render outside Fabric. It finds
// the seam by string matching, so a refactor that is perfectly valid TypeScript can
// still break it — and the failure surfaces as a screenshot judge with nothing to
// grade, never as a build or type error. These assertions reproduce that matcher.

describe("eval-harness fixture-patch contract", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/connectors.ts"), "utf8");
    const declaration = /^export const connectorRuntimes\b/m;
    const semanticModelCall = /fabricSemanticModel\(\s*(\{\s*\})?\s*\)/g;

    it("declares connectorRuntimes at the top level", () => {
        expect(declaration.test(source)).toBe(true);
    });

    it("closes the runtime declaration with `};` at column zero", () => {
        const start = declaration.exec(source)?.index ?? -1;
        expect(start).toBeGreaterThanOrEqual(0);
        expect(source.indexOf("\n};", start)).toBeGreaterThan(start);
    });

    it("contains exactly one fabricSemanticModel(...) inside that declaration", () => {
        const start = declaration.exec(source)!.index;
        const end = source.indexOf("\n};", start);
        const block = source.slice(start, end + 3);
        expect([...block.matchAll(semanticModelCall)]).toHaveLength(1);
    });

    it("survives the harness rewrite, with the capture runtime taking precedence", () => {
        const start = declaration.exec(source)!.index;
        const end = source.indexOf("\n};", start);
        const patched = source.slice(start, end + 3).replace(
            semanticModelCall,
            (_m, options: string | undefined) =>
                `captureSemanticModelRuntime ?? fabricSemanticModel(${options ?? ""})`,
        );
        expect(patched).toContain("captureSemanticModelRuntime ?? fabricSemanticModel({})");
        // Every connector picks it up, not just the first one.
        expect(patched).toContain("Object.keys(connectorConfigs).map");
    });
});
