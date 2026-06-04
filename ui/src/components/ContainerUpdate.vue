<template>
  <div>
    <div v-if="hasUpdates" class="pa-4">
      <div class="update-summary">
        <div class="summary-item">
          <div class="text-caption text-medium-emphasis">Current</div>
          <div class="summary-value">{{ currentVersion }}</div>
        </div>
        <div class="summary-item">
          <div class="text-caption text-medium-emphasis">Selected</div>
          <div class="summary-value">{{ selectedVersion }}</div>
        </div>
        <div class="summary-item">
          <div class="text-caption text-medium-emphasis">Status</div>
          <v-chip
            size="small"
            label
            :color="candidateStatusColor(selectedCandidate)"
          >
            {{ selectedStatus }}
          </v-chip>
        </div>
        <div class="summary-item" v-if="minAge">
          <div class="text-caption text-medium-emphasis">Minimum age</div>
          <div class="summary-value">{{ minAge }}</div>
        </div>
        <div class="summary-item">
          <div class="text-caption text-medium-emphasis">Selection</div>
          <div class="selection-summary">
            <v-chip
              size="small"
              label
              variant="outlined"
              :color="isManualSelection ? 'secondary' : undefined"
            >
              {{ selectionModeLabel }}
            </v-chip>
            <v-tooltip bottom v-if="isManualSelection">
              <template v-slot:activator="{ props }">
                <v-btn
                  variant="text"
                  size="small"
                  icon
                  v-bind="props"
                  @click.stop="resetSelection"
                >
                  <v-icon size="small">mdi-refresh-auto</v-icon>
                </v-btn>
              </template>
              <span class="text-caption">Return to automatic selection</span>
            </v-tooltip>
          </div>
        </div>
      </div>

      <div class="candidate-list">
        <div
          class="candidate-row"
          :class="{ 'candidate-row--selected': candidate.selected }"
          v-for="candidate in candidateRows"
          :key="`${candidate.tag ?? ''}-${candidate.digest ?? ''}-${candidate.created ?? ''}`"
        >
          <div class="candidate-main">
            <v-icon :color="candidateStatusColor(candidate)" size="small">
              {{ candidateIcon(candidate) }}
            </v-icon>
            <v-icon v-if="candidate.selected" size="small">
              mdi-check-circle
            </v-icon>
            <span class="candidate-value">{{ candidateValue(candidate) }}</span>
            <span v-if="candidate.selected" class="candidate-selected-label">
              Selected
            </span>
            <v-chip
              size="x-small"
              variant="outlined"
              :color="candidateStatusColor(candidate)"
              label
            >
              {{ candidateStatus(candidate) }}
            </v-chip>
            <v-chip
              v-if="displayUpdateKind(candidate)"
              size="x-small"
              variant="outlined"
              :color="updateKindColor(displayUpdateKind(candidate))"
              label
            >
              {{ formatUpdateKind(displayUpdateKind(candidate)) }}
            </v-chip>
          </div>

          <div class="candidate-meta">
            <span v-if="candidateTagMeta(candidate)">
              {{ candidateTagMeta(candidate) }}
            </span>
            <span v-if="candidate.created">
              Image created {{ $filters.dateTime(candidate.created) }}
            </span>
            <span v-if="candidate.updatePendingUntil">
              Pending until {{ $filters.dateTime(candidate.updatePendingUntil) }}
            </span>
            <span v-if="candidate.digest">
              Digest {{ candidateDigest(candidate) }}
            </span>
          </div>

          <div class="candidate-actions">
            <v-tooltip bottom v-if="canSelectCandidate(candidate)">
              <template v-slot:activator="{ props }">
                <v-btn
                  variant="text"
                  size="small"
                  icon
                  v-bind="props"
                  @click.stop="selectCandidate(candidate)"
                >
                  <v-icon size="small">mdi-check-circle-outline</v-icon>
                </v-btn>
              </template>
              <span class="text-caption">Use this candidate</span>
            </v-tooltip>
            <v-tooltip bottom v-if="canCopyCandidateTag(candidate)">
              <template v-slot:activator="{ props }">
                <v-btn
                  variant="text"
                  size="small"
                  icon
                  v-bind="props"
                  @click="copyToClipboard('update tag', candidate.tag)"
                >
                  <v-icon size="small">mdi-tag</v-icon>
                </v-btn>
              </template>
              <span class="text-caption">Copy tag</span>
            </v-tooltip>
            <v-tooltip
              bottom
              v-if="candidate.digest || candidate.updateKind?.kind === 'digest'"
            >
              <template v-slot:activator="{ props }">
                <v-btn
                  variant="text"
                  size="small"
                  icon
                  v-bind="props"
                  @click="
                    copyToClipboard(
                      'update digest',
                      candidate.digest ?? candidate.updateKind.remoteValue
                    )
                  "
                >
                  <v-icon size="small">mdi-function-variant</v-icon>
                </v-btn>
              </template>
              <span class="text-caption">Copy digest</span>
            </v-tooltip>
            <v-tooltip bottom v-if="candidate.link">
              <template v-slot:activator="{ props }">
                <v-btn
                  :href="candidate.link"
                  target="_blank"
                  variant="text"
                  size="small"
                  icon
                  v-bind="props"
                >
                  <v-icon size="small">mdi-link</v-icon>
                </v-btn>
              </template>
              <span class="text-caption">Open link</span>
            </v-tooltip>
          </div>
        </div>
      </div>
    </div>
    <v-card-text v-else>No update available</v-card-text>
  </div>
</template>

<script lang="ts" src="./ContainerUpdate.ts"></script>

<style scoped>
.update-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.summary-item {
  min-width: 0;
}

.summary-value {
  overflow-wrap: anywhere;
  font-weight: 500;
}

.selection-summary {
  align-items: center;
  display: flex;
  gap: 4px;
}

.candidate-list {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  overflow: hidden;
}

.candidate-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.4fr) minmax(120px, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
}

.candidate-row + .candidate-row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.candidate-row--selected {
  background: rgba(var(--v-theme-on-surface), 0.08);
  border-left: 4px solid rgb(var(--v-theme-secondary));
  padding-left: 8px;
}

.candidate-main,
.candidate-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.candidate-main {
  min-width: 0;
  flex-wrap: wrap;
}

.candidate-value {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 500;
}

.candidate-selected-label {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
  font-weight: 600;
}

.candidate-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  overflow-wrap: anywhere;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.8rem;
}

@media (max-width: 720px) {
  .candidate-row {
    grid-template-columns: 1fr;
  }

  .candidate-actions {
    justify-content: flex-start;
  }
}
</style>
