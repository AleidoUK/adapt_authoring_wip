function metadataFor(type, item) {
  if (['lightcourse', 'lightcourseversion', 'lightcourseexport'].indexOf(type) === -1) return;
  var id = type === 'lightcourse' ? item._id : item._lightCourseId;
  if (!id) return;
  var metadata = { lightCourseId: String(id) };
  var version = type === 'lightcourse' ? item.currentVersionNumber || 'draft' : item.versionNumber;
  if (version) metadata.lightCourseVersion = version;
  return metadata;
}

function versionFor(log, versions) {
  if (log.metadata && log.metadata.lightCourseVersion) return log.metadata.lightCourseVersion;
  var snapshot = log.snapshot || {};
  if (snapshot.currentVersionNumber) return snapshot.currentVersionNumber;
  if (snapshot.versionNumber) return snapshot.versionNumber;
  if (snapshot._versionId) {
    var version = (versions || []).find(function(item) { return String(item._id) === String(snapshot._versionId); });
    if (version) return version.versionNumber;
  }
  if (log.contentType === 'lightcourse' && snapshot.revision !== undefined) return 'draft';
  return 'unknown';
}

module.exports = { metadataFor: metadataFor, versionFor: versionFor };
