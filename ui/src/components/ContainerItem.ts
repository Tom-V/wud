import { useDisplay } from "vuetify";
import { getRegistryProviderIcon } from "@/services/registry";
import ContainerDetail from "@/components/ContainerDetail.vue";
import ContainerError from "@/components/ContainerError.vue";
import ContainerImage from "@/components/ContainerImage.vue";
import ContainerTriggers from "@/components/ContainerTriggers.vue";
import ContainerUpdate from "@/components/ContainerUpdate.vue";
import IconRenderer from "@/components/IconRenderer.vue";
import { defineComponent } from "vue";

function isVisibleUpdateCandidate(container: any, candidate: any) {
  if (!candidate) {
    return false;
  }
  if (candidate.updateAvailable || candidate.updatePending) {
    return true;
  }
  const currentTag = container?.image?.tag?.value;
  const digestCandidate =
    candidate.updateKind?.kind === "digest" ||
    (candidate.digest !== undefined && candidate.tag === currentTag);
  if (digestCandidate) {
    return true;
  }
  return candidate.tag !== undefined && candidate.tag !== currentTag;
}

export default defineComponent({
  emits: ["container-updated", "delete-container"],
  setup() {
    const { smAndUp, mdAndUp } = useDisplay();
    return { smAndUp, mdAndUp };
  },
  components: {
    ContainerDetail,
    ContainerError,
    ContainerImage,
    ContainerTriggers,
    ContainerUpdate,
    IconRenderer,
  },

  props: {
    container: {
      type: Object,
      required: true,
    },
    previousContainer: {
      type: Object,
      required: false,
    },
    groupingLabel: {
      type: String,
      required: true,
    },
    oldestFirst: {
      type: Boolean,
      required: false,
    },
  },
  data() {
    return {
      showDetail: false,
      dialogDelete: false,
      tab: 0,
      deleteEnabled: false,
    };
  },
  computed: {
    registryIcon() {
      return getRegistryProviderIcon(this.container.image.registry.name);
    },

    showGroupingHeader() {
      return (
        this.groupingLabel &&
        this.previousContainer?.labels?.[this.groupingLabel] !==
          this.container.labels?.[this.groupingLabel]
      );
    },

    groupingValue() {
      return this.container.labels?.[this.groupingLabel] ?? "(empty)";
    },

    formattedCreatedDate() {
      return (this as any).$filters.date(this.container.image.created);
    },

    osIcon() {
      let icon = "mdi-help";
      switch (this.container.image.os) {
        case "linux":
          icon = "mdi-linux";
          break;
        case "windows":
          icon = "mdi-microsoft-windows";
          break;
      }
      return icon;
    },

    newVersion() {
      let newVersion = "unknown";
      if (
        this.container.result.created &&
        this.container.image.created !== this.container.result.created
      ) {
        newVersion = (this as any).$filters.dateTime(
          this.container.result.created,
        );
      }
      if (this.container.updateKind) {
        newVersion = this.container.updateKind.remoteValue;
      }
      if (this.container.updateKind.kind === "digest") {
        newVersion = (this as any).$filters.short(newVersion, 15);
      }
      return newVersion;
    },

    updateCandidateCount() {
      const results = Array.isArray(this.container.results)
        ? this.container.results
        : [];
      if (results.length > 0) {
        return results.filter((candidate: any) =>
          isVisibleUpdateCandidate(this.container, candidate),
        ).length;
      }
      return this.container.updateAvailable || this.container.updatePending
        ? 1
        : 0;
    },

    newVersionClass() {
      if (this.container.updatePending) {
        return "info";
      }
      let color = "warning";
      if (
        this.container.updateKind &&
        this.container.updateKind.kind === "tag"
      ) {
        switch (this.container.updateKind.semverDiff) {
          case "major":
            color = "error";
            break;
          case "minor":
            color = "warning";
            break;
          case "patch":
            color = "success";
            break;
        }
      }
      return color;
    },
  },

  methods: {
    async deleteContainer() {
      this.$emit("delete-container");
    },

    copyToClipboard(kind: string, value: string) {
      navigator.clipboard.writeText(value);
      (this as any).$eventBus.emit("notify", `${kind} copied to clipboard`);
    },

    collapseDetail() {
      // Prevent collapse when selecting text only
      if (window.getSelection()?.type !== "Range") {
        this.showDetail = !this.showDetail;
      }

      // Hack because of a render bug on tabs inside a collapsible element
      if ((this.$refs.tabs as any) && (this.$refs.tabs as any).onResize) {
        (this.$refs.tabs as any).onResize();
      }
    },

    normalizeFontawesome(iconString: string, prefix: string) {
      return `${prefix} fa-${iconString.replace(`${prefix}:`, "")}`;
    },
  },

  mounted() {
    this.deleteEnabled = (this as any).$serverConfig?.feature?.delete || false;
  },
});
