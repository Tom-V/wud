export type DockerImageName = {
    domain?: string;
    path: string;
    tag?: string;
    digest?: string;
};

/**
 * Determine if a path component is a registry domain according to Docker's rules.
 * Docker treats the first path component as a registry domain if it contains a "." or ":", or if it is exactly "localhost".
 */
function isRegistryDomain(component: string) {
    return (
        component === 'localhost' ||
        component.includes('.') ||
        component.includes(':')
    );
}

/**
 * Split a Docker image reference into the pieces WUD needs.
 *
 * Docker references use the shape:
 *   [registry-domain[:port]/]repository/path[:tag][@digest]
 *
 * The tricky part is deciding whether the first path component is a registry
 * domain or just part of the image name.
 */
export function parseDockerImageName(image: string): DockerImageName {
    const [nameAndTag, digest] = image.split('@', 2);
    const lastSlashIndex = nameAndTag.lastIndexOf('/');
    const tagSeparatorIndex = nameAndTag.lastIndexOf(':');
    // A ":" before the last "/" belongs to the registry port, not to a tag.
    const hasTag = tagSeparatorIndex > lastSlashIndex;

    const name = hasTag ? nameAndTag.slice(0, tagSeparatorIndex) : nameAndTag;
    const tag = hasTag ? nameAndTag.slice(tagSeparatorIndex + 1) : undefined;
    const [firstComponent, ...pathComponents] = name.split('/');
    const hasDomain =
        pathComponents.length > 0 && isRegistryDomain(firstComponent);
    const path = hasDomain ? pathComponents.join('/') : name;

    const parsedImage: DockerImageName = { path };
    if (hasDomain) {
        parsedImage.domain = firstComponent;
    }
    if (tag) {
        parsedImage.tag = tag;
    }
    if (digest) {
        parsedImage.digest = digest;
    }

    return parsedImage;
}
