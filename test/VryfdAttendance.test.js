const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("VRYFD System — Sepolia", function () {
  let vryfToken, attendance;
  let owner, organizer, attendee1, attendee2, relayer;

  beforeEach(async function () {
    [owner, organizer, attendee1, attendee2, relayer] = await ethers.getSigners();

    // Deploy VRYF Token
    const VRYFToken = await ethers.getContractFactory("VRYFToken");
    vryfToken = await VRYFToken.deploy();
    await vryfToken.waitForDeployment();

    // Deploy Attendance contract with VRYF token link
    const VryfdAttendance = await ethers.getContractFactory("VryfdAttendance");
    attendance = await VryfdAttendance.deploy("ipfs://", await vryfToken.getAddress());
    await attendance.waitForDeployment();

    // Grant MINTER_ROLE to attendance contract
    const MINTER_ROLE = await vryfToken.MINTER_ROLE();
    await vryfToken.grantRole(MINTER_ROLE, await attendance.getAddress());

    // Grant roles
    const ORGANIZER_ROLE = await attendance.ORGANIZER_ROLE();
    const RELAYER_ROLE = await attendance.RELAYER_ROLE();
    await attendance.grantRole(ORGANIZER_ROLE, organizer.address);
    await attendance.grantRole(RELAYER_ROLE, relayer.address);
  });

  // ─── VRYF Token ──────────────────────────────────

  describe("$VRYF Token", function () {
    it("should have correct name and symbol", async function () {
      expect(await vryfToken.name()).to.equal("VRYF Token");
      expect(await vryfToken.symbol()).to.equal("VRYF");
    });

    it("should start with zero supply", async function () {
      expect(await vryfToken.totalSupply()).to.equal(0);
    });

    it("should have 1M max supply cap", async function () {
      expect(await vryfToken.MAX_SUPPLY()).to.equal(ethers.parseEther("1000000"));
    });

    it("should have correct reward amounts", async function () {
      expect(await vryfToken.checkInReward()).to.equal(ethers.parseEther("10"));
      expect(await vryfToken.badgeReward()).to.equal(ethers.parseEther("25"));
      expect(await vryfToken.bronzeReward()).to.equal(ethers.parseEther("100"));
      expect(await vryfToken.silverReward()).to.equal(ethers.parseEther("250"));
      expect(await vryfToken.goldReward()).to.equal(ethers.parseEther("500"));
    });
  });

  // ─── Feature 1: ENS Check-in + VRYF Reward ──────

  describe("Feature 1: Check-in earns $VRYF", function () {
    let eventId;

    beforeEach(async function () {
      const now = await time.latest();
      await attendance
        .connect(organizer)
        .createEvent("IIIT Sricity Hackathon", "ipfs://QmBadge1", now, now + 86400);
      eventId = 0;
    });

    it("should create an event", async function () {
      const event = await attendance.events(eventId);
      expect(event.name).to.equal("IIIT Sricity Hackathon");
      expect(event.active).to.be.true;
    });

    it("should confirm attendance and earn 10 VRYF", async function () {
      await attendance.connect(attendee1).confirmAttendance(eventId);

      // Check attendance recorded
      const record = await attendance.getAttendanceRecord(eventId, attendee1.address);
      expect(record.timestamp).to.be.gt(0);

      // Check VRYF balance: 10 tokens
      const balance = await vryfToken.balanceOf(attendee1.address);
      expect(balance).to.equal(ethers.parseEther("10"));
    });

    it("should not allow double check-in", async function () {
      await attendance.connect(attendee1).confirmAttendance(eventId);
      await expect(
        attendance.connect(attendee1).confirmAttendance(eventId)
      ).to.be.revertedWith("Already checked in");
    });

    it("should accumulate VRYF across multiple events", async function () {
      // Create 3 events and check in
      for (let i = 0; i < 3; i++) {
        const now = await time.latest();
        await attendance
          .connect(organizer)
          .createEvent(`Event ${i}`, `ipfs://Qm${i}`, now, now + 86400);
        await attendance.connect(attendee1).confirmAttendance(i);
      }

      // 3 check-ins x 10 VRYF = 30 VRYF
      const balance = await vryfToken.balanceOf(attendee1.address);
      expect(balance).to.equal(ethers.parseEther("30"));
    });
  });

  // ─── Feature 2: POAP Badges + VRYF Reward ───────

  describe("Feature 2: Badge claim earns $VRYF", function () {
    let eventId;

    beforeEach(async function () {
      const now = await time.latest();
      await attendance
        .connect(organizer)
        .createEvent("Workshop", "ipfs://QmWorkshop", now, now + 86400);
      eventId = 0;
      await attendance.connect(attendee1).confirmAttendance(eventId);
    });

    it("should mint badge and earn 25 VRYF", async function () {
      await attendance.connect(attendee1).claimBadge(eventId);

      const tokenId = await attendance.eventBadgeToken(eventId);
      expect(await attendance.balanceOf(attendee1.address, tokenId)).to.equal(1);

      // 10 (check-in) + 25 (badge) = 35 VRYF
      const balance = await vryfToken.balanceOf(attendee1.address);
      expect(balance).to.equal(ethers.parseEther("35"));
    });

    it("should not mint badge without attendance", async function () {
      await expect(
        attendance.connect(attendee2).claimBadge(eventId)
      ).to.be.revertedWith("Not attended");
    });

    it("should be soulbound (non-transferable)", async function () {
      await attendance.connect(attendee1).claimBadge(eventId);
      const tokenId = await attendance.eventBadgeToken(eventId);

      await expect(
        attendance
          .connect(attendee1)
          .safeTransferFrom(attendee1.address, attendee2.address, tokenId, 1, "0x")
      ).to.be.revertedWith("Soulbound: non-transferable");
    });
  });

  // ─── Feature 3: Milestone NFTs + VRYF Reward ────

  describe("Feature 3: Milestone earns $VRYF", function () {
    it("should award Bronze + 100 VRYF at 5 events", async function () {
      for (let i = 0; i < 5; i++) {
        const now = await time.latest();
        await attendance
          .connect(organizer)
          .createEvent(`Event ${i}`, `ipfs://Qm${i}`, now, now + 86400);
        await attendance.connect(attendee1).confirmAttendance(i);
      }

      expect(await attendance.totalAttendance(attendee1.address)).to.equal(5);

      // Set milestone URI and claim
      await attendance.connect(organizer).setMilestoneURI(5, "ipfs://QmBronze");
      await attendance.connect(attendee1).claimMilestoneReward();

      // 5 check-ins x 10 VRYF + 100 VRYF milestone = 150 VRYF
      const balance = await vryfToken.balanceOf(attendee1.address);
      expect(balance).to.equal(ethers.parseEther("150"));

      expect(await attendance.highestMilestoneClaimed(attendee1.address)).to.equal(5);
    });

    it("should return correct user tier", async function () {
      expect(await attendance.getUserTier(attendee1.address)).to.equal("Newcomer");

      for (let i = 0; i < 5; i++) {
        const now = await time.latest();
        await attendance
          .connect(organizer)
          .createEvent(`E${i}`, `ipfs://Q${i}`, now, now + 86400);
        await attendance.connect(attendee1).confirmAttendance(i);
      }

      expect(await attendance.getUserTier(attendee1.address)).to.equal("Bronze Explorer");
    });
  });

  // ─── Feature 4: Certificates ─────────────────────

  describe("Feature 4: Time-Stamped Certificates", function () {
    let eventId;

    beforeEach(async function () {
      const now = await time.latest();
      await attendance
        .connect(organizer)
        .createEvent("Conference", "ipfs://QmConf", now, now + 86400);
      eventId = 0;
      await attendance.connect(attendee1).confirmAttendance(eventId);
    });

    it("should issue a certificate", async function () {
      await attendance
        .connect(organizer)
        .issueCertificate(eventId, attendee1.address, "ipfs://QmCert1");

      const cert = await attendance.verifyCertificate(0);
      expect(cert.attendee).to.equal(attendee1.address);
      expect(cert.isValid).to.be.true;
    });

    it("should revoke a certificate", async function () {
      await attendance
        .connect(organizer)
        .issueCertificate(eventId, attendee1.address, "ipfs://QmCert1");

      await attendance.connect(organizer).revokeCertificate(0);
      const cert = await attendance.verifyCertificate(0);
      expect(cert.isValid).to.be.false;
    });

    it("should not issue cert for non-attendee", async function () {
      await expect(
        attendance
          .connect(organizer)
          .issueCertificate(eventId, attendee2.address, "ipfs://QmCert2")
      ).to.be.revertedWith("Attendee not recorded");
    });
  });

  // ─── VRYF Token Admin ────────────────────────────

  describe("$VRYF Admin Functions", function () {
    it("should allow admin to update reward amounts", async function () {
      await vryfToken.setCheckInReward(ethers.parseEther("20"));
      expect(await vryfToken.checkInReward()).to.equal(ethers.parseEther("20"));
    });

    it("should not allow non-admin to update rewards", async function () {
      await expect(
        vryfToken.connect(attendee1).setCheckInReward(ethers.parseEther("999"))
      ).to.be.reverted;
    });
  });
});
