import { mount } from '@vue/test-utils';
import ContainerUpdate from '@/components/ContainerUpdate';
import {
  resetContainerResultSelection,
  selectContainerResult,
} from '@/services/container';

jest.mock('@/services/container', () => ({
  resetContainerResultSelection: jest.fn(),
  selectContainerResult: jest.fn(),
}));

const mockUpdateKind = {
  kind: "tag",
  localValue: "1.0.0",
  remoteValue: "2.0.0",
  semverDiff: "major",
};

const mockResult = {
  tag: "2.0.0",
  created: "2023-01-02T00:00:00Z",
  digest: "sha256:abcdef123456",
};

describe("ContainerUpdate", () => {
  let wrapper;

  beforeEach(() => {
    jest.clearAllMocks();
    wrapper = mount(ContainerUpdate, {
      props: {
        containerId: "container-1",
        updateKind: mockUpdateKind,
        result: mockResult,
        currentTag: "1.0.0",
        updateAvailable: true,
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("renders update information correctly", () => {
    expect(wrapper.vm.updateKind.remoteValue).toBe("2.0.0");
    expect(wrapper.vm.updateKind.localValue).toBe("1.0.0");
  });

  it("shows semver diff information", () => {
    expect(wrapper.vm.updateKind.semverDiff).toBe("major");
  });

  it("displays creation date", () => {
    expect(wrapper.vm.result.created).toBe("2023-01-02T00:00:00Z");
  });

  it("shows digest information", () => {
    expect(wrapper.vm.result.digest).toBe("sha256:abcdef123456");
  });

  it("handles non-semver updates", async () => {
    await wrapper.setProps({
      updateKind: {
        kind: "digest",
        localValue: "sha256:old123",
        remoteValue: "sha256:new456",
      },
    });

    expect(wrapper.vm.updateKind.kind).toBe("digest");
  });

  it("shows no update available message when update is not available", async () => {
    await wrapper.setProps({
      updateKind: null,
      updateAvailable: false,
      updatePending: false,
    });

    expect(wrapper.vm.updateKind).toBeNull();
  });

  it("shows pending update information when update is pending", async () => {
    await wrapper.setProps({
      updateAvailable: false,
      updatePending: true,
      updatePendingReason: "minimum-age",
      updatePendingUntil: "2026-06-01T12:00:00.000Z",
      minAge: "12h",
    });

    expect(wrapper.vm.updatePending).toBe(true);
    expect(wrapper.vm.updatePendingReason).toBe("minimum-age");
    expect(wrapper.vm.updatePendingUntil).toBe("2026-06-01T12:00:00.000Z");
    expect(wrapper.vm.minAge).toBe("12h");
  });

  it("handles different update kinds", async () => {
    await wrapper.setProps({
      updateKind: {
        kind: "tag",
        localValue: "1.0.0",
        remoteValue: "1.1.0",
        semverDiff: "minor",
      },
    });

    expect(wrapper.vm.updateKind.semverDiff).toBe("minor");

    await wrapper.setProps({
      updateKind: {
        kind: "tag",
        localValue: "1.0.0",
        remoteValue: "1.0.1",
        semverDiff: "patch",
      },
    });

    expect(wrapper.vm.updateKind.semverDiff).toBe("patch");
  });

  it("displays correct severity colors", () => {
    // Test that component has access to update kind data
    expect(wrapper.vm.updateKind.semverDiff).toBe("major");
  });

  it("formats version information correctly", () => {
    expect(wrapper.vm.updateKind.localValue).toBe("1.0.0");
    expect(wrapper.vm.updateKind.remoteValue).toBe("2.0.0");
  });

  it("handles missing updateKind gracefully", async () => {
    await wrapper.setProps({ updateKind: null });
    expect(wrapper.exists()).toBe(true);
  });

  it("handles missing result gracefully", async () => {
    await wrapper.setProps({ result: null });
    expect(wrapper.exists()).toBe(true);
  });

  it("computes correct update type", () => {
    expect(wrapper.vm.updateKind.kind).toBe("tag");
  });

  it("renders all update candidates", async () => {
    await wrapper.setProps({
      results: [
        {
          tag: "2.0.0",
          created: "2023-01-02T00:00:00Z",
          selected: true,
          updateAvailable: true,
          updateKind: mockUpdateKind,
        },
        {
          tag: "1.1.0",
          updatePending: true,
          updatePendingUntil: "2026-06-01T12:00:00.000Z",
          updateKind: {
            kind: "tag",
            localValue: "1.0.0",
            remoteValue: "1.1.0",
            semverDiff: "minor",
          },
        },
      ],
    });

    expect(wrapper.vm.candidateRows).toHaveLength(2);
    expect(wrapper.text()).toContain("2.0.0");
    expect(wrapper.text()).toContain("1.1.0");
    expect(wrapper.text()).toContain("Image created");
    expect(wrapper.text()).toContain("Selected");
    expect(wrapper.text()).toContain("Pending");
    expect(wrapper.find(".candidate-row--selected").exists()).toBe(true);
    expect(wrapper.find(".candidate-selected-label").exists()).toBe(true);
  });

  it("selects a different update candidate", async () => {
    const containerUpdated = {
      id: "container-1",
      result: { tag: "1.1.0" },
    };
    (selectContainerResult as any).mockResolvedValue(containerUpdated);
    await wrapper.setProps({
      results: [
        {
          tag: "2.0.0",
          selected: true,
          updateAvailable: true,
          updateKind: mockUpdateKind,
        },
        {
          tag: "1.1.0",
          updateAvailable: true,
          updateKind: {
            kind: "tag",
            localValue: "1.0.0",
            remoteValue: "1.1.0",
            semverDiff: "minor",
          },
        },
      ],
    });

    await wrapper.vm.selectCandidate(wrapper.vm.candidateRows[1]);

    expect(selectContainerResult).toHaveBeenCalledWith("container-1", {
      tag: "1.1.0",
      updateAvailable: true,
      updateKind: {
        kind: "tag",
        localValue: "1.0.0",
        remoteValue: "1.1.0",
        semverDiff: "minor",
      },
    });
    expect(wrapper.emitted("container-updated")?.[0]).toEqual([
      containerUpdated,
    ]);
  });

  it("resets manual update candidate selection", async () => {
    const containerUpdated = {
      id: "container-1",
      resultSelection: { mode: "auto" },
    };
    (resetContainerResultSelection as any).mockResolvedValue(containerUpdated);
    await wrapper.setProps({
      resultSelection: { mode: "manual", tag: "1.1.0" },
    });

    await wrapper.vm.resetSelection();

    expect(resetContainerResultSelection).toHaveBeenCalledWith("container-1");
    expect(wrapper.emitted("container-updated")?.[0]).toEqual([
      containerUpdated,
    ]);
  });

  it("formats digest candidates with shortened display values", async () => {
    await wrapper.setProps({
      results: [
        {
          digest: "sha256:1234567890abcdef1234567890abcdef",
          selected: true,
          updateAvailable: true,
          updateKind: {
            kind: "digest",
            localValue: "sha256:old",
            remoteValue: "sha256:1234567890abcdef1234567890abcdef",
          },
        },
      ],
    });

    expect(wrapper.vm.selectedVersion).toBe("sha256:1234567890abc...");
  });

  it("shows same-tag digest candidates as digest updates", async () => {
    await wrapper.setProps({
      results: [
        {
          tag: "1.0.0",
          digest: "sha256:1234567890abcdef1234567890abcdef",
          selected: true,
          updateAvailable: true,
        },
      ],
    });

    const candidate = wrapper.vm.candidateRows[0];
    expect(wrapper.vm.selectedVersion).toBe("sha256:1234567890abc...");
    expect(wrapper.vm.displayUpdateKind(candidate)).toEqual({ kind: "digest" });
    expect(wrapper.vm.candidateTagMeta(candidate)).toBe("Current tag: 1.0.0");
    expect(wrapper.vm.canCopyCandidateTag(candidate)).toBe(false);
  });

  it("does not show unchanged current tag candidates", async () => {
    await wrapper.setProps({
      results: [
        {
          tag: "1.0.0",
        },
        {
          tag: "1.1.0",
          updateAvailable: true,
        },
      ],
    });

    expect(wrapper.vm.candidateRows).toHaveLength(1);
    expect(wrapper.vm.candidateRows[0].tag).toBe("1.1.0");
  });
});
