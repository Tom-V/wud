<template>
  <v-container fluid>
    <v-row dense>
      <v-col>
        <container-filter
          :registries="registries"
          :registry-selected-init="registrySelected"
          :watchers="watchers"
          :watcher-selected-init="watcherSelected"
          :update-kinds="updateKinds"
          :update-kind-selected-init="updateKindSelected"
          :updateAvailable="updateAvailableSelected"
          :oldestFirst="oldestFirst"
          :groupByLabel="groupByLabel"
          :groupLabels="allContainerLabels"
          @registry-changed="onRegistryChanged"
          @watcher-changed="onWatcherChanged"
          @update-available-changed="onUpdateAvailableChanged"
          @oldest-first-changed="onOldestFirstChanged"
          @group-by-label-changed="onGroupByLabelChanged"
          @update-kind-changed="onUpdateKindChanged"
          @refresh-all-containers="onRefreshAllContainers"
        />
      </v-col>
    </v-row>
<v-row
        v-for="(container, index) in containersFiltered"
        :key="container.id"
      >
        <v-col class="pt-2 pb-2">
          <container-item
            :groupingLabel="groupByLabel"
            :previousContainer="getPreviousContainer(index)"
            :container="container"
            :oldest-first="oldestFirst"
            @delete-container="deleteContainer(container)"
            @container-deleted="removeContainerFromList(container)"
            @container-updated="updateContainerInList"
          />
        </v-col>
      </v-row>
    <v-row v-if="containersFiltered.length === 0">
      <v-card-subtitle class="text-h6">No containers found</v-card-subtitle>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import ContainerItem from "@/components/ContainerItem.vue";
import ContainerFilter from "@/components/ContainerFilter.vue";
import { deleteContainer, getAllContainers } from "@/services/container";
import { defineComponent } from "vue";

export default defineComponent({
  components: {
    ContainerItem,
    ContainerFilter,
  },

  data() {
    return {
      containers: [] as any[],
      registrySelected: "",
      watcherSelected: "",
      updateKindSelected: "",
      updateAvailableSelected: false,
      groupByLabel: "",
      oldestFirst: false,
    };
  },
  watch: {},
  computed: {
    allContainerLabels() {
      const allLabels = this.containers.reduce((acc, container) => {
        return [...acc, ...Object.keys(container.labels ?? {})];
      }, []);
      return [...new Set(allLabels)].sort();
    },
    registries() {
      return [
        ...new Set(
          this.containers
            .map((container) => container.image.registry.name)
            .sort(),
        ),
      ];
    },
    watchers() {
      return [
        ...new Set(
          this.containers.map((container) => container.watcher).sort(),
        ),
      ];
    },
    updateKinds() {
      return [
        ...new Set(
          this.containers
            .flatMap((container) => this.getContainerUpdateKinds(container))
            .sort(),
        ),
      ];
    },
    containersFiltered() {
      const filteredContainers = this.containers
        .filter((container) =>
          this.registrySelected
            ? this.registrySelected === container.image.registry.name
            : true,
        )
        .filter((container) =>
          this.watcherSelected
            ? this.watcherSelected === container.watcher
            : true,
        )
        .filter((container) =>
          this.updateKindSelected
            ? this.getContainerUpdateKinds(container).includes(
                this.updateKindSelected,
              )
            : true,
        )
        .filter((container) =>
          this.updateAvailableSelected ? container.updateAvailable : true,
        )
        .sort((a, b) => {
          const getImageDate = (item: any) => new Date(item.image.created);

          if (this.groupByLabel) {
            const aLabel = a.labels?.[this.groupByLabel];
            const bLabel = b.labels?.[this.groupByLabel];

            if (aLabel && !bLabel) return -1;
            if (!aLabel && bLabel) return 1;

            if (aLabel && bLabel) {
              if (this.oldestFirst) return (getImageDate(a) as any) - (getImageDate(b) as any);

              return aLabel.localeCompare(bLabel);
            }
          }

          if (this.oldestFirst) return (getImageDate(a) as any) - (getImageDate(b) as any);
          return a.displayName.localeCompare(b.displayName);
        });
      return filteredContainers;
    },
  },

  methods: {
    onRegistryChanged(registrySelected: string) {
      this.registrySelected = registrySelected;
      this.updateQueryParams();
    },
    onWatcherChanged(watcherSelected: string) {
      this.watcherSelected = watcherSelected;
      this.updateQueryParams();
    },
    onUpdateAvailableChanged() {
      this.updateAvailableSelected = !this.updateAvailableSelected;
      this.updateQueryParams();
    },
    onOldestFirstChanged() {
      this.oldestFirst = !this.oldestFirst;
      this.updateQueryParams();
    },
    onGroupByLabelChanged(groupByLabel: string) {
      this.groupByLabel = groupByLabel;
      this.updateQueryParams();
    },
    onUpdateKindChanged(updateKindSelected: string) {
      this.updateKindSelected = updateKindSelected;
      this.updateQueryParams();
    },
    getContainerUpdateKinds(container: any) {
      const results = Array.isArray(container.results) ? container.results : [];
      const resultKinds = results
        .filter((result: any) => result.updateAvailable || result.updatePending)
        .filter((result: any) => result.updateKind?.kind === "tag")
        .filter((result: any) => result.updateKind?.semverDiff)
        .map((result: any) => result.updateKind.semverDiff);

      if (resultKinds.length > 0) {
        return resultKinds;
      }

      return container.updateAvailable &&
        container.updateKind?.kind === "tag" &&
        container.updateKind?.semverDiff
        ? [container.updateKind.semverDiff]
        : [];
    },
    updateQueryParams() {
      const query: any = {};
      if (this.registrySelected) {
        query["registry"] = this.registrySelected;
      }
      if (this.watcherSelected) {
        query["watcher"] = this.watcherSelected;
      }
      if (this.updateKindSelected) {
        query["update-kind"] = this.updateKindSelected;
      }
      if (this.updateAvailableSelected) {
        query["update-available"] = String(this.updateAvailableSelected);
      }
      if (this.oldestFirst) {
        query["oldest-first"] = String(this.oldestFirst);
      }
      if (this.groupByLabel) {
        query["group-by-label"] = this.groupByLabel;
      }
      this.$router.push({ query });
    },
    onRefreshAllContainers(containersRefreshed: any[]) {
      this.containers = containersRefreshed;
    },
    removeContainerFromList(container: any) {
      this.containers = this.containers.filter((c) => c.id !== container.id);
    },
    getPreviousContainer(index: number) {
      return index > 0 ? this.containersFiltered[index - 1] : undefined;
    },
    updateContainerInList(containerUpdated: any) {
      this.containers = this.containers.map((container) =>
        container.id === containerUpdated.id ? containerUpdated : container,
      );
    },
    async deleteContainer(container: any) {
      try {
        await deleteContainer(container.id);
        this.removeContainerFromList(container);
      } catch (e: any) {
        (this as any).$eventBus.emit(
          "notify",
          `Error when trying to delete the container (${e.message})`,
          "error",
        );
      }
    },
  },

  async beforeRouteEnter(to, from, next) {
    const registrySelected = to.query["registry"];
    const watcherSelected = to.query["watcher"];
    const updateKindSelected = to.query["update-kind"];
    const updateAvailable = to.query["update-available"];
    const oldestFirst = to.query["oldest-first"];
    const groupByLabel = to.query["group-by-label"];
    try {
      const containers = await getAllContainers();
      next((vm: any) => {
        if (registrySelected) {
          vm.registrySelected = registrySelected;
        }
        if (watcherSelected) {
          vm.watcherSelected = watcherSelected;
        }
        if (updateKindSelected) {
          vm.updateKindSelected = updateKindSelected;
        }
        if (updateAvailable) {
          vm.updateAvailableSelected = (updateAvailable as string).toLowerCase() === "true";
        }
        if (oldestFirst) {
          vm.oldestFirst = (oldestFirst as string).toLowerCase() === "true";
        }
        if (groupByLabel) {
          vm.groupByLabel = groupByLabel;
        }
        vm.containers = containers;
      });
    } catch (e: any) {
      next((vm: any) => {
        vm.$eventBus.emit(
          "notify",
          `Error when trying to get the containers (${e.message})`,
          "error",
        );
      });
    }
  },
});
</script>
