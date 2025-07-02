export default class PackBuildInformation {
    /** @type {string} */ type;
    /** @type {string} */ uuid;
    /** @type {number[]} */ version;
    /** @type {URL} */ location;

    /**
     * @param {string} type
     * @param {string} uuid
     * @param {number[]} version
     * @param {URL} location
     */
    constructor(type, uuid, version, location) {
        this.type = type;
        this.uuid = uuid;
        this.version = version;
        this.location = location;
    }
}
