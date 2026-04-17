// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "./VRYFToken.sol";

/// @notice Minimal interface to read attendance eligibility from the existing VryfdAttendance contract.
interface IVryfdAttendance {
    function isEligibleForCertificate(uint256 eventId, address attendee) external view returns (bool);

    /// @dev Public `events` getter on VryfdAttendance. We only need the organizer + active fields here,
    ///      but Solidity auto-generates one getter that returns every value in declaration order.
    function events(uint256 eventId)
        external
        view
        returns (
            string memory name,
            string memory metadataURI,
            uint256 startTime,
            uint256 endTime,
            address organizer,
            bool active,
            uint256 attendanceThreshold,
            uint256 claimPeriodDays,
            uint256 durationMinutes,
            uint8 eventType
        );
}

/**
 * @title  VryfdBadge
 * @notice Soulbound ERC-721 POAP badges. One unique tokenId per attendee per event.
 *         Organizer sets the badge metadata URI per event (pointing to IPFS).
 *         Attendees claim gaslessly via EIP-712 signature + backend relayer once
 *         they've met the attendance threshold on the existing attendance contract.
 */
contract VryfdBadge is ERC721, AccessControl, EIP712 {
    using ECDSA for bytes32;

    // ───────────────── Roles ─────────────────
    bytes32 public constant ORGANIZER_ROLE = keccak256("ORGANIZER_ROLE");
    bytes32 public constant RELAYER_ROLE   = keccak256("RELAYER_ROLE");

    // ───────────────── External contracts ─────────────────
    IVryfdAttendance public immutable attendance;
    VRYFToken       public immutable vryfToken;

    // ───────────────── Storage ─────────────────

    /// @notice Per-event badge metadata URI (set by the event organizer).
    mapping(uint256 => string) public eventBadgeURI;

    /// @notice Whether an attendee has already claimed a badge for an event.
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice Per-token URI — stamped at mint time so organizer edits don't
    ///         retroactively change badges already minted.
    mapping(uint256 => string) private _tokenURIs;

    /// @notice tokenId → eventId — for analytics & frontend listing.
    mapping(uint256 => uint256) public tokenEvent;

    /// @notice Attendees can have multiple badges, so we track per-user token list.
    mapping(address => uint256[]) private _ownedTokens;

    /// @notice EIP-712 replay-protection nonce, separate from the attendance contract's nonce.
    mapping(address => uint256) public nonces;

    /// @notice Next tokenId. Starts at 1 so tokenId 0 is reserved / "unset".
    uint256 public nextTokenId = 1;

    // ───────────────── EIP-712 ─────────────────
    bytes32 public constant CLAIM_BADGE_TYPEHASH =
        keccak256("ClaimBadge(address attendee,uint256 eventId,uint256 nonce)");

    // ───────────────── Events ─────────────────
    event BadgeMetadataSet(uint256 indexed eventId, string metadataURI, address indexed organizer);
    event BadgeClaimed(uint256 indexed eventId, address indexed attendee, uint256 tokenId, string metadataURI);

    // ───────────────── Errors ─────────────────
    error BadgeAlreadyClaimed();
    error BadgeMetadataNotSet();
    error NotEligible();
    error InvalidSignature();
    error EventNotFound();
    error NotEventOrganizer();
    error Soulbound();

    // ───────────────── Constructor ─────────────────
    constructor(address attendanceAddress, address vryfTokenAddress)
        ERC721("VRYFD POAP Badge", "VRYFD-POAP")
        EIP712("VryfdBadge", "1")
    {
        require(attendanceAddress != address(0) && vryfTokenAddress != address(0), "zero address");
        attendance = IVryfdAttendance(attendanceAddress);
        vryfToken  = VRYFToken(vryfTokenAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ORGANIZER_ROLE, msg.sender);
        _grantRole(RELAYER_ROLE,   msg.sender);
    }

    // ───────────────── Organizer: set badge metadata ─────────────────

    /// @notice Organizer registers / updates the badge metadata URI for an event.
    /// @dev Only the event's original organizer (as recorded on the attendance contract)
    ///      OR an account with ORGANIZER_ROLE on this contract can set it.
    function setEventBadge(uint256 eventId, string calldata metadataURI) external {
        (, , , , address organizer, bool active, , , , ) = attendance.events(eventId);
        if (organizer == address(0) && !active) revert EventNotFound();
        if (msg.sender != organizer && !hasRole(ORGANIZER_ROLE, msg.sender)) {
            revert NotEventOrganizer();
        }
        require(bytes(metadataURI).length > 0, "empty URI");

        eventBadgeURI[eventId] = metadataURI;
        emit BadgeMetadataSet(eventId, metadataURI, msg.sender);
    }

    // ───────────────── Gasless claim (EIP-712) ─────────────────

    /// @notice Relayer submits an attendee's signed claim. Attendee pays zero gas.
    /// @dev    Nonce is incremented BEFORE the external VRYF mint (CEI pattern).
    function claimBadgeGasless(
        address attendee,
        uint256 eventId,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyRole(RELAYER_ROLE) returns (uint256 tokenId) {
        // ── Checks ──
        if (claimed[eventId][attendee]) revert BadgeAlreadyClaimed();
        string memory uriStr = eventBadgeURI[eventId];
        if (bytes(uriStr).length == 0) revert BadgeMetadataNotSet();
        if (!attendance.isEligibleForCertificate(eventId, attendee)) revert NotEligible();

        bytes32 structHash = keccak256(
            abi.encode(CLAIM_BADGE_TYPEHASH, attendee, eventId, nonces[attendee])
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, v, r, s) != attendee) revert InvalidSignature();

        // ── Effects ──
        nonces[attendee] += 1;
        claimed[eventId][attendee] = true;

        tokenId = nextTokenId++;
        _tokenURIs[tokenId] = uriStr;
        tokenEvent[tokenId] = eventId;
        _ownedTokens[attendee].push(tokenId);

        // ── Interactions ──
        _safeMint(attendee, tokenId);
        try vryfToken.mintBadgeReward(attendee) {} catch {}

        emit BadgeClaimed(eventId, attendee, tokenId, uriStr);
    }

    /// @notice User-pays-gas direct claim (optional fallback for power users).
    function claimBadge(uint256 eventId) external returns (uint256 tokenId) {
        address attendee = msg.sender;
        if (claimed[eventId][attendee]) revert BadgeAlreadyClaimed();
        string memory uriStr = eventBadgeURI[eventId];
        if (bytes(uriStr).length == 0) revert BadgeMetadataNotSet();
        if (!attendance.isEligibleForCertificate(eventId, attendee)) revert NotEligible();

        claimed[eventId][attendee] = true;

        tokenId = nextTokenId++;
        _tokenURIs[tokenId] = uriStr;
        tokenEvent[tokenId] = eventId;
        _ownedTokens[attendee].push(tokenId);

        _safeMint(attendee, tokenId);
        try vryfToken.mintBadgeReward(attendee) {} catch {}

        emit BadgeClaimed(eventId, attendee, tokenId, uriStr);
    }

    // ───────────────── Views ─────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _tokenURIs[tokenId];
    }

    /// @notice Returns all badge tokenIds held by an address (including burned/re-indexed entries).
    /// @dev    Frontend should filter by `ownerOf(tokenId) == user` to ignore anything that was burned.
    function tokensOfOwner(address owner) external view returns (uint256[] memory) {
        return _ownedTokens[owner];
    }

    function hasClaimed(uint256 eventId, address attendee) external view returns (bool) {
        return claimed[eventId][attendee];
    }

    // ───────────────── Soulbound enforcement ─────────────────

    /// @dev OZ v5 ERC721: `_update` is the single hook for mint/transfer/burn.
    ///      `auth == address(0)` for mint; `to == address(0)` for burn. Block everything else.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }

    // ───────────────── Required overrides ─────────────────

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
