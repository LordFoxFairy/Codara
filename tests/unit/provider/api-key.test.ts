import {describe, expect, it, beforeEach, afterEach} from "bun:test";
import {expandApiKey} from "@core/provider";

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

    it("环境变量为空字符串时应抛出错误", () => {
        process.env.EMPTY_API_KEY = "   ";
        expect(() => expandApiKey("$EMPTY_API_KEY")).toThrow('环境变量 "EMPTY_API_KEY" 不能为空字符串');
    });

    it("环境变量名为空时应抛出错误", () => {
        expect(() => expandApiKey("$   ")).toThrow("apiKey 环境变量名不能为空");
    });

    it("空字符串应返回 undefined", () => {
        expect(expandApiKey("")).toBeUndefined();
    });

    it("undefined 应返回 undefined", () => {
        expect(expandApiKey(undefined)).toBeUndefined();
    });
});
