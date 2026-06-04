import { defineComponent } from "vue";
import {
  resetContainerResultSelection,
  selectContainerResult,
} from "@/services/container";

export default defineComponent({
  emits: ["container-updated"],
  props: {
    containerId: {
      type: String,
      required: true,
    },
    resultSelection: {
      type: Object,
      default: () => ({ mode: "auto" }),
    },
    semver: {
      type: Boolean,
    },
    result: {
      type: Object,
    },
    results: {
      type: Array,
      default: () => [],
    },
    currentTag: {
      type: String,
    },
    updateKind: {
      type: Object,
    },
    updateAvailable: {
      type: Boolean,
    },
    updatePending: {
      type: Boolean,
    },
    updatePendingReason: {
      type: String,
    },
    updatePendingUntil: {
      type: String,
    },
    minAge: {
      type: String,
    },
  },
  computed: {
    candidateRows() {
      const results = Array.isArray(this.results) ? this.results : [];
      if (results.length > 0) {
        return results.filter((candidate: any) =>
          this.isVisibleCandidate(candidate),
        );
      }
      if (this.result && (this.updateAvailable || this.updatePending)) {
        return [
          {
            ...this.result,
            updateKind: this.updateKind,
            updateAvailable: this.updateAvailable,
            updatePending: this.updatePending,
            updatePendingReason: this.updatePendingReason,
            updatePendingUntil: this.updatePendingUntil,
            selected: true,
          },
        ];
      }
      return [];
    },

    hasUpdates() {
      return this.candidateRows.length > 0;
    },

    selectedCandidate() {
      return (
        this.candidateRows.find((candidate: any) => candidate.selected) ??
        this.candidateRows[0]
      );
    },

    currentVersion() {
      return this.currentTag ?? this.updateKind?.localValue ?? "unknown";
    },

    selectedVersion() {
      return this.candidateValue(this.selectedCandidate);
    },

    selectedStatus() {
      return this.candidateStatus(this.selectedCandidate);
    },

    updateKindFormatted() {
      return this.formatUpdateKind(this.updateKind);
    },

    isManualSelection() {
      return this.resultSelection?.mode === "manual";
    },

    selectionModeLabel() {
      return this.isManualSelection ? "Manual" : "Automatic";
    },
  },
  methods: {
    formatUpdateKind(updateKind: any) {
      let kind = "Unknown";
      if (updateKind) {
        kind = updateKind.kind;
      }
      if (updateKind?.semverDiff) {
        kind = updateKind.semverDiff;
      }
      return kind;
    },

    updateKindColor(updateKind: any) {
      switch (updateKind?.semverDiff) {
        case "major":
          return "error";
        case "minor":
          return "warning";
        case "patch":
          return "success";
        case "prerelease":
          return "info";
        default:
          return updateKind?.kind === "digest" ? "secondary" : "warning";
      }
    },

    candidateStatus(candidate: any) {
      if (candidate?.updatePending) {
        return "Pending";
      }
      if (candidate?.updateAvailable) {
        return "Available";
      }
      return "Found";
    },

    candidateStatusColor(candidate: any) {
      if (candidate?.updatePending) {
        return "info";
      }
      if (candidate?.updateAvailable) {
        return "success";
      }
      return "secondary";
    },

    candidateIcon(candidate: any) {
      if (candidate?.updatePending) {
        return "mdi-clock-outline";
      }
      if (this.isDigestCandidate(candidate)) {
        return "mdi-function-variant";
      }
      return "mdi-package-down";
    },

    isDigestCandidate(candidate: any) {
      return (
        candidate?.updateKind?.kind === "digest" ||
        (candidate?.digest !== undefined && candidate?.tag === this.currentTag)
      );
    },

    displayUpdateKind(candidate: any) {
      if (candidate?.updateKind) {
        return candidate.updateKind;
      }
      if (this.isDigestCandidate(candidate)) {
        return { kind: "digest" };
      }
      return undefined;
    },

    isVisibleCandidate(candidate: any) {
      if (!candidate) {
        return false;
      }
      if (candidate.updateAvailable || candidate.updatePending) {
        return true;
      }
      if (this.isDigestCandidate(candidate)) {
        return true;
      }
      return candidate.tag !== undefined && candidate.tag !== this.currentTag;
    },

    candidateValue(candidate: any) {
      if (this.isDigestCandidate(candidate)) {
        const value =
          candidate?.updateKind?.remoteValue ?? candidate?.digest ?? "unknown";
        return (this as any).$filters.short(value, 20);
      }

      const value =
        candidate?.updateKind?.remoteValue ??
        candidate?.tag ??
        candidate?.digest ??
        "unknown";
      return value;
    },

    candidateDigest(candidate: any) {
      return candidate?.digest
        ? (this as any).$filters.short(candidate.digest, 32)
        : "";
    },

    candidateTagMeta(candidate: any) {
      if (this.isDigestCandidate(candidate) && candidate?.tag) {
        return `Current tag: ${candidate.tag}`;
      }
      return "";
    },

    canCopyCandidateTag(candidate: any) {
      return candidate?.tag && !this.isDigestCandidate(candidate);
    },

    canSelectCandidate(candidate: any) {
      return candidate && !candidate.selected;
    },

    async selectCandidate(candidate: any) {
      try {
        const container = await selectContainerResult(
          this.containerId,
          candidate,
        );
        this.$emit("container-updated", container);
        (this as any).$eventBus.emit(
          "notify",
          "Update candidate selected",
        );
      } catch (e: any) {
        (this as any).$eventBus.emit(
          "notify",
          `Error when selecting update candidate (${e.message})`,
          "error",
        );
      }
    },

    async resetSelection() {
      try {
        const container = await resetContainerResultSelection(this.containerId);
        this.$emit("container-updated", container);
        (this as any).$eventBus.emit(
          "notify",
          "Automatic update candidate selection restored",
        );
      } catch (e: any) {
        (this as any).$eventBus.emit(
          "notify",
          `Error when resetting update candidate selection (${e.message})`,
          "error",
        );
      }
    },

    copyToClipboard(kind: string, value: string) {
      navigator.clipboard.writeText(value);
      (this as any).$eventBus.emit("notify", `${kind} copied to clipboard`);
    },
  },
});
