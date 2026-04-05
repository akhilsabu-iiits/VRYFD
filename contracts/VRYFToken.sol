// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title VRYFToken
 * @notice The native reward token for the VRYFD attendance ecosystem.
 *         Users earn $VRYF for checking in, claiming badges, and hitting milestones.
 * @dev 
 *   - Name: VRYF Token
 *   - Symbol: VRYF
 *   - Decimals: 18 (standard)
 *   - Minting: Only MINTER_ROLE (granted to VryfdAttendance contract)
 *   - Initial supply: 0 (all tokens are earned, not pre-minted)
 */
contract VRYFToken is ERC20, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    // ── Reward amounts (in wei, 18 decimals) ──
    uint256 public checkInReward   = 10 * 10**18;    // 10 VRYF per check-in
    uint256 public badgeReward     = 25 * 10**18;    // 25 VRYF per badge claim
    uint256 public bronzeReward    = 100 * 10**18;   // 100 VRYF at 5 events
    uint256 public silverReward    = 250 * 10**18;   // 250 VRYF at 10 events
    uint256 public goldReward      = 500 * 10**18;   // 500 VRYF at 20 events

    // ── Supply cap ──
    uint256 public constant MAX_SUPPLY = 1_000_000 * 10**18; // 1 million VRYF max

    // ── Events ──
    event RewardMinted(address indexed to, uint256 amount, string reason);
    event RewardAmountUpdated(string rewardType, uint256 newAmount);

    constructor() ERC20("VRYF Token", "VRYF") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
    }

    /**
     * @notice Mint reward tokens to a user
     * @dev Only callable by addresses with MINTER_ROLE (the attendance contract)
     */
    function mintReward(
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "VRYF: max supply exceeded");
        _mint(to, amount);
        emit RewardMinted(to, amount, reason);
    }

    /**
     * @notice Mint check-in reward
     */
    function mintCheckInReward(address to) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + checkInReward <= MAX_SUPPLY, "VRYF: max supply exceeded");
        _mint(to, checkInReward);
        emit RewardMinted(to, checkInReward, "check-in");
    }

    /**
     * @notice Mint badge claim reward
     */
    function mintBadgeReward(address to) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + badgeReward <= MAX_SUPPLY, "VRYF: max supply exceeded");
        _mint(to, badgeReward);
        emit RewardMinted(to, badgeReward, "badge-claim");
    }

    /**
     * @notice Mint milestone reward (Bronze/Silver/Gold)
     */
    function mintMilestoneReward(address to, uint256 threshold) external onlyRole(MINTER_ROLE) {
        uint256 amount;
        string memory reason;

        if (threshold == 5) {
            amount = bronzeReward;
            reason = "milestone-bronze";
        } else if (threshold == 10) {
            amount = silverReward;
            reason = "milestone-silver";
        } else if (threshold == 20) {
            amount = goldReward;
            reason = "milestone-gold";
        } else {
            revert("VRYF: invalid milestone threshold");
        }

        require(totalSupply() + amount <= MAX_SUPPLY, "VRYF: max supply exceeded");
        _mint(to, amount);
        emit RewardMinted(to, amount, reason);
    }

    // ── Admin functions ──

    function setCheckInReward(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        checkInReward = amount;
        emit RewardAmountUpdated("checkIn", amount);
    }

    function setBadgeReward(uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        badgeReward = amount;
        emit RewardAmountUpdated("badge", amount);
    }

    function setMilestoneRewards(
        uint256 bronze,
        uint256 silver,
        uint256 gold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bronzeReward = bronze;
        silverReward = silver;
        goldReward = gold;
        emit RewardAmountUpdated("milestones", bronze + silver + gold);
    }
}
