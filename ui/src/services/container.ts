import { url } from "./base";

function getContainerIcon() {
  return "mdi-docker";
}

async function getAllContainers() {
  const response = await fetch(url("api/containers"), { credentials: "include" });
  return response.json();
}

async function refreshAllContainers() {
  const response = await fetch(url("api/containers/watch"), {
    method: "POST",
    credentials: "include",
  });
  return response.json();
}

async function refreshContainer(containerId) {
  const response = await fetch(url(`api/containers/${containerId}/watch`), {
    method: "POST",
    credentials: "include",
  });
  if (response.status === 404) {
    return undefined;
  }
  return response.json();
}

async function deleteContainer(containerId) {
  return fetch(url(`api/containers/${containerId}`), { method: "DELETE", credentials: "include" });
}

async function readErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

async function selectContainerResult(containerId, candidate) {
  const response = await fetch(`/api/containers/${containerId}/result-selection`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "manual",
      tag: candidate.tag,
      digest: candidate.digest,
      created: candidate.created,
    }),
  });
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, "Unable to select update candidate"),
    );
  }
  return response.json();
}

async function resetContainerResultSelection(containerId) {
  const response = await fetch(`/api/containers/${containerId}/result-selection`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        "Unable to reset update candidate selection",
      ),
    );
  }
  return response.json();
}

async function getContainerTriggers(containerId) {
  const response = await fetch(url(`api/containers/${containerId}/triggers`), { credentials: "include" });
  return response.json();
}

async function runTrigger({ containerId, triggerType, triggerName }) {
  const response = await fetch(
    url(`api/containers/${containerId}/triggers/${triggerType}/${triggerName}`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    },
  );
  return response.json();
}

export {
  getContainerIcon,
  getAllContainers,
  refreshAllContainers,
  refreshContainer,
  deleteContainer,
  selectContainerResult,
  resetContainerResultSelection,
  getContainerTriggers,
  runTrigger,
};
