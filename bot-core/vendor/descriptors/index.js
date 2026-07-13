import { _Enum } from 'polkadot-api';

const table = new Uint8Array(128);
for (let i = 0; i < 64; i++) table[i < 26 ? i + 65 : i < 52 ? i + 71 : i < 62 ? i - 4 : i * 4 - 205] = i;
const toBinary = (base64) => {
  const n = base64.length, bytes = new Uint8Array((n - Number(base64[n - 1] === "=") - Number(base64[n - 2] === "=")) * 3 / 4 | 0);
  for (let i2 = 0, j = 0; i2 < n; ) {
    const c0 = table[base64.charCodeAt(i2++)], c1 = table[base64.charCodeAt(i2++)];
    const c2 = table[base64.charCodeAt(i2++)], c3 = table[base64.charCodeAt(i2++)];
    bytes[j++] = c0 << 2 | c1 >> 4;
    bytes[j++] = c1 << 4 | c2 >> 2;
    bytes[j++] = c2 << 6 | c3;
  }
  return bytes;
};

const descriptorValues$1 = import('./descriptors-CCYquBSv.js').then((module) => module["PaseoPeopleNext"]);
const metadataTypes$1 = import('./metadataTypes-BuljkfVT.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const asset$1 = {};
const extensions$1 = {};
const getMetadata$2 = () => import('./paseoPeopleNext_metadata-DfetSzwV.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis$1 = "0xc5af1826b31493f08b7e2a823842f98575b806a784126f28da9608c68665afa5";
const _allDescriptors$1 = { descriptors: descriptorValues$1, metadataTypes: metadataTypes$1, asset: asset$1, extensions: extensions$1, getMetadata: getMetadata$2, genesis: genesis$1 };

const descriptorValues = import('./descriptors-CCYquBSv.js').then((module) => module["BulletinPaseoNextV2"]);
const metadataTypes = import('./metadataTypes-BuljkfVT.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const asset = {};
const extensions = {};
const getMetadata$1 = () => import('./bulletinPaseoNextV2_metadata-BaLIpmxp.js').then(
  (module) => toBinary("default" in module ? module.default : module)
);
const genesis = "0x8cfe6717dc4becfda2e13c488a1e2061ff2dfee96e7d031157f72d36716c0a22";
const _allDescriptors = { descriptors: descriptorValues, metadataTypes, asset, extensions, getMetadata: getMetadata$1, genesis };

const DigestItem = _Enum;
const Phase = _Enum;
const DispatchClass = _Enum;
const TokenError = _Enum;
const ArithmeticError = _Enum;
const TransactionalError = _Enum;
const BalanceStatus = _Enum;
const TransactionPaymentEvent = _Enum;
const XcmV5Junctions = _Enum;
const XcmV5Junction = _Enum;
const XcmV5NetworkId = _Enum;
const XcmV3JunctionBodyId = _Enum;
const XcmV2JunctionBodyPart = _Enum;
const XcmV5Instruction = _Enum;
const XcmV3MultiassetFungibility = _Enum;
const XcmV3MultiassetAssetInstance = _Enum;
const XcmV3MaybeErrorCode = _Enum;
const XcmV2OriginKind = _Enum;
const XcmV5AssetFilter = _Enum;
const XcmV5WildAsset = _Enum;
const XcmV2MultiassetWildFungibility = _Enum;
const XcmV3WeightLimit = _Enum;
const XcmVersionedAssets = _Enum;
const XcmV3MultiassetAssetId = _Enum;
const XcmV3Junctions = _Enum;
const XcmV3Junction = _Enum;
const XcmV3JunctionNetworkId = _Enum;
const XcmVersionedLocation = _Enum;
const UpgradeGoAhead = _Enum;
const UpgradeRestriction = _Enum;
const BalancesTypesReasons = _Enum;
const TransactionPaymentReleases = _Enum;
const XcmV3Response = _Enum;
const XcmV3TraitsError = _Enum;
const XcmV4Response = _Enum;
const XcmPalletVersionMigrationStage = _Enum;
const XcmVersionedAssetId = _Enum;
const IdentityData = _Enum;
const MultiAddress = _Enum;
const BalancesAdjustmentDirection = _Enum;
const XcmVersionedXcm = _Enum;
const XcmV3Instruction = _Enum;
const XcmV3MultiassetMultiAssetFilter = _Enum;
const XcmV3MultiassetWildMultiAsset = _Enum;
const XcmV4Instruction = _Enum;
const XcmV4AssetAssetFilter = _Enum;
const XcmV4AssetWildAsset = _Enum;
const TransactionValidityUnknownTransaction = _Enum;
const TransactionValidityTransactionSource = _Enum;
const XcmVersionedAsset = _Enum;

const metadatas = {
  ["0x097791dfb5f5285085f7c54145dad4e9c0c270020fc1a7335c224354436b0c01"]: _allDescriptors$1,
  ["0x4fe167698d8a654b0d832ffa2b22471689331b278d93e1802b4f3d469b807d5a"]: _allDescriptors
};
const getMetadata = async (codeHash) => {
  try {
    return await metadatas[codeHash].getMetadata();
  } catch {
  }
  return null;
};

export { ArithmeticError, BalanceStatus, BalancesAdjustmentDirection, BalancesTypesReasons, DigestItem, DispatchClass, IdentityData, MultiAddress, Phase, TokenError, TransactionPaymentEvent, TransactionPaymentReleases, TransactionValidityTransactionSource, TransactionValidityUnknownTransaction, TransactionalError, UpgradeGoAhead, UpgradeRestriction, XcmPalletVersionMigrationStage, XcmV2JunctionBodyPart, XcmV2MultiassetWildFungibility, XcmV2OriginKind, XcmV3Instruction, XcmV3Junction, XcmV3JunctionBodyId, XcmV3JunctionNetworkId, XcmV3Junctions, XcmV3MaybeErrorCode, XcmV3MultiassetAssetId, XcmV3MultiassetAssetInstance, XcmV3MultiassetFungibility, XcmV3MultiassetMultiAssetFilter, XcmV3MultiassetWildMultiAsset, XcmV3Response, XcmV3TraitsError, XcmV3WeightLimit, XcmV4AssetAssetFilter, XcmV4AssetWildAsset, XcmV4Instruction, XcmV4Response, XcmV5AssetFilter, XcmV5Instruction, XcmV5Junction, XcmV5Junctions, XcmV5NetworkId, XcmV5WildAsset, XcmVersionedAsset, XcmVersionedAssetId, XcmVersionedAssets, XcmVersionedLocation, XcmVersionedXcm, _allDescriptors as bulletinPaseoNextV2, getMetadata, _allDescriptors$1 as paseoPeopleNext };
