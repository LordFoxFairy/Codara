import {describe, expect, it} from 'bun:test';
import {applyPermissionMode} from '@core/middleware/permission/policy';
import type {PermissionMode} from '@config/schema';

describe('applyPermissionMode', () => {
  describe('default mode', () => {
    it('should not transform any decision', () => {
      expect(applyPermissionMode('allow', 'default', 'Bash')).toBe('allow');
      expect(applyPermissionMode('ask', 'default', 'Bash')).toBe('ask');
      expect(applyPermissionMode('deny', 'default', 'Bash')).toBe('deny');
    });

    it('should treat undefined mode as default', () => {
      expect(applyPermissionMode('allow', undefined, 'Bash')).toBe('allow');
      expect(applyPermissionMode('ask', undefined, 'Bash')).toBe('ask');
      expect(applyPermissionMode('deny', undefined, 'Bash')).toBe('deny');
    });
  });

  describe('bypassPermissions mode', () => {
    const mode: PermissionMode = 'bypassPermissions';

    it('should allow everything regardless of input decision', () => {
      expect(applyPermissionMode('allow', mode, 'Bash')).toBe('allow');
      expect(applyPermissionMode('ask', mode, 'Bash')).toBe('allow');
      expect(applyPermissionMode('deny', mode, 'Bash')).toBe('allow');
    });

    it('should allow everything for any tool', () => {
      expect(applyPermissionMode('deny', mode, 'Read')).toBe('allow');
      expect(applyPermissionMode('deny', mode, 'Write')).toBe('allow');
      expect(applyPermissionMode('ask', mode, 'Edit')).toBe('allow');
    });
  });

  describe('dontAsk mode', () => {
    const mode: PermissionMode = 'dontAsk';

    it('should convert ask to deny', () => {
      expect(applyPermissionMode('ask', mode, 'Bash')).toBe('deny');
    });

    it('should leave allow unchanged', () => {
      expect(applyPermissionMode('allow', mode, 'Bash')).toBe('allow');
    });

    it('should leave deny unchanged', () => {
      expect(applyPermissionMode('deny', mode, 'Bash')).toBe('deny');
    });
  });

  describe('plan mode', () => {
    const mode: PermissionMode = 'plan';

    it('should convert allow to ask (everything needs approval)', () => {
      expect(applyPermissionMode('allow', mode, 'Bash')).toBe('ask');
    });

    it('should leave ask unchanged', () => {
      expect(applyPermissionMode('ask', mode, 'Bash')).toBe('ask');
    });

    it('should leave deny unchanged', () => {
      expect(applyPermissionMode('deny', mode, 'Bash')).toBe('deny');
    });
  });

  describe('acceptEdits mode', () => {
    const mode: PermissionMode = 'acceptEdits';

    it('should auto-allow file edit tools when decision is ask', () => {
      for (const tool of ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'read_file', 'write_file', 'edit_file', 'glob', 'grep']) {
        expect(applyPermissionMode('ask', mode, tool)).toBe('allow');
      }
    });

    it('should not transform non-edit tools', () => {
      expect(applyPermissionMode('ask', mode, 'Bash')).toBe('ask');
      expect(applyPermissionMode('ask', mode, 'Fetch')).toBe('ask');
    });

    it('should not transform allow decisions for edit tools', () => {
      expect(applyPermissionMode('allow', mode, 'Write')).toBe('allow');
    });

    it('should not transform deny decisions for edit tools', () => {
      expect(applyPermissionMode('deny', mode, 'Write')).toBe('deny');
    });
  });
});
