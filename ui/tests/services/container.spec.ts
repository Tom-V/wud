import {
  getAllContainers,
  refreshAllContainers,
  refreshContainer,
  deleteContainer,
  selectContainerResult,
  resetContainerResultSelection,
  getContainerTriggers,
  runTrigger
} from '@/services/container';

// Mock fetch globally
global.fetch = jest.fn();

describe('Container Service', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  describe('getAllContainers', () => {
    it('fetches all containers successfully', async () => {
      const mockContainers = [
        { id: '1', name: 'container1' },
        { id: '2', name: 'container2' }
      ];
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContainers
      });

      const containers = await getAllContainers();

      expect(fetch).toHaveBeenCalledWith('/api/containers', {
        credentials: 'include'
      });
      expect(containers).toEqual(mockContainers);
    });
  });

  describe('refreshAllContainers', () => {
    it('refreshes all containers successfully', async () => {
      const mockResult = { refreshed: 10 };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await refreshAllContainers();

      expect(fetch).toHaveBeenCalledWith('/api/containers/watch', {
        method: 'POST',
        credentials: 'include'
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('refreshContainer', () => {
    it('refreshes specific container successfully', async () => {
      const mockResult = { id: 'container1', refreshed: true };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await refreshContainer('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/watch', {
        method: 'POST',
        credentials: 'include'
      });
      expect(result).toEqual(mockResult);
    });

    it('returns undefined when container not found', async () => {
      fetch.mockResolvedValueOnce({
        status: 404
      });

      const result = await refreshContainer('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('deleteContainer', () => {
    it('deletes container successfully', async () => {
      fetch.mockResolvedValueOnce({
        ok: true
      });

      const result = await deleteContainer('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1', {
        method: 'DELETE',
        credentials: 'include'
      });
      expect(result).toBeDefined();
    });
  });

  describe('selectContainerResult', () => {
    it('persists a manual result selection', async () => {
      const mockResult = { id: 'container1', resultSelection: { mode: 'manual' } };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await selectContainerResult('container1', {
        tag: '1.1.0',
        digest: 'sha256:new',
        created: '2026-06-01T00:00:00.000Z'
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/containers/container1/result-selection',
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'manual',
            tag: '1.1.0',
            digest: 'sha256:new',
            created: '2026-06-01T00:00:00.000Z'
          })
        }
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('resetContainerResultSelection', () => {
    it('resets a manual result selection', async () => {
      const mockResult = { id: 'container1', resultSelection: { mode: 'auto' } };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await resetContainerResultSelection('container1');

      expect(fetch).toHaveBeenCalledWith(
        '/api/containers/container1/result-selection',
        {
          method: 'DELETE',
          credentials: 'include'
        }
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getContainerTriggers', () => {
    it('fetches container triggers successfully', async () => {
      const mockTriggers = [
        { type: 'webhook', name: 'trigger1' },
        { type: 'email', name: 'trigger2' }
      ];
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTriggers
      });

      const triggers = await getContainerTriggers('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/triggers', {
        credentials: 'include'
      });
      expect(triggers).toEqual(mockTriggers);
    });
  });

  describe('runTrigger', () => {
    it('runs trigger successfully', async () => {
      const mockResult = { success: true, message: 'Trigger executed' };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await runTrigger({
        containerId: 'container1',
        triggerType: 'webhook',
        triggerName: 'trigger1'
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/containers/container1/triggers/webhook/trigger1',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        }
      );
      expect(result).toEqual(mockResult);
    });
  });
});
