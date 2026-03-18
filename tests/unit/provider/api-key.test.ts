import {describe, expect, it, beforeEach, afterEach, mock} from "bun:test";
import {expandApiKey} from "@integration/provider";

describe("expandApiKey", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {...originalEnv};
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("应返回字面量密钥", () => {
        expect(expandApiKey("sk-literal-key")).toBe("sk-literal-key");
    });

    it("应解析环境变量", () => {
        process.env.TEST_API_KEY = "sk-from-env";
        expect(expandApiKey("$TEST_API_KEY")).toBe("sk-from-env");
    });

    it("环境变量未设置时应返回 undefined", () => {
        expect(expandApiKey("$MISSING_VAR")).toBeUndefined();
    });

    it("环境变量为空字符串时应返回 undefined", () => {
        process.env.EMPTY_API_KEY = "   ";
        expect(expandApiKey("$EMPTY_API_KEY")).toBeUndefined();
    });

    it("环境变量名为空时应返回 undefined", () => {
        expect(expandApiKey("$   ")).toBeUndefined();
    });

    it("环境变量名为空时应触发 warning", () => {
        const onWarning = mock();
        expect(expandApiKey("$   ", onWarning)).toBeUndefined();
        expect(onWarning).toHaveBeenCalledWith("apiKey 环境变量名为空，已跳过");
    });

    it("环境变量为空字符串时应触发 warning", () => {
        const onWarning = mock();
        process.env.EMPTY_API_KEY = "   ";
        expect(expandApiKey("$EMPTY_API_KEY", onWarning)).toBeUndefined();
        expect(onWarning).toHaveBeenCalledWith('环境变量 "EMPTY_API_KEY" 为空字符串，已跳过');
    });

    it("空字符串应返回 undefined", () => {
        expect(expandApiKey("")).toBeUndefined();
    });

    it("undefined 应返回 undefined", () => {
        expect(expandApiKey(undefined)).toBeUndefined();
    });
});
