/* global artifacts, web3, contract */
require('chai').use(require('bn-chai')(web3.utils.BN)).use(require('chai-as-promised')).should()

const { toBN } = require('web3-utils')
const { takeSnapshot, revertSnapshot, mineBlock } = require('../scripts/ganacheHelper')
const { sacredFormula, reverseSacredFormula } = require('../src/utils')
const Sacred = artifacts.require('TORNMock')
const RewardSwap = artifacts.require('RewardSwapMock')
const sacredConfig = require('torn-token')
const RLP = require('rlp')

const MONTH = toBN(60 * 60 * 24 * 30)
const DURATION = toBN(60 * 60 * 24 * 365)

// Set time to beginning of a second
async function timeReset() {
  const delay = 1000 - new Date().getMilliseconds()
  await new Promise((resolve) => setTimeout(resolve, delay))
  await mineBlock()
}

async function getNextAddr(sender, offset = 0) {
  const nonce = await web3.eth.getTransactionCount(sender)
  return (
    '0x' +
    web3.utils
      .sha3(RLP.encode([sender, Number(nonce) + Number(offset)]))
      .slice(12)
      .substring(14)
  )
}

contract('RewardSwap', (accounts) => {
  let sacred
  let rewardSwap
  let amount
  const sacredCap = toBN(sacredConfig.torn.cap)
  const miningCap = toBN(sacredConfig.torn.distribution.miningV2.amount)
  const initialSacredBalance = toBN(sacredConfig.miningV2.initialBalance)
  let yearLiquidity
  let delta = toBN(100000) // 0.0000000000001 sacred error
  // eslint-disable-next-line no-unused-vars
  const sender = accounts[0]
  const recipient = accounts[1]
  // eslint-disable-next-line no-unused-vars
  const relayer = accounts[2]
  let snapshotId
  const thirtyDays = 30 * 24 * 3600
  const poolWeight = 1e11

  before(async () => {
    const swapExpectedAddr = await getNextAddr(accounts[0], 1)
    sacred = await Sacred.new(sender, thirtyDays, [
      { to: swapExpectedAddr, amount: miningCap.toString() },
      { to: sender, amount: sacredCap.sub(miningCap).toString() },
    ])
    rewardSwap = await RewardSwap.new(
      sacred.address,
      sender,
      miningCap.toString(),
      initialSacredBalance.toString(),
      poolWeight,
    )
    yearLiquidity = miningCap.sub(initialSacredBalance)
    amount = toBN(await rewardSwap.poolWeight()).mul(toBN(7)) // 10**10

    snapshotId = await takeSnapshot()
  })

  beforeEach(async () => {
    await timeReset()
  })

  describe('#formula test', () => {
    it('should work', async () => {
      let formulaReturn
      let expectedReturn
      amount = amount.mul(toBN(5))
      for (let i = 1; i < 11; i++) {
        amount = amount.div(toBN(i))
        formulaReturn = sacredFormula({ balance: initialSacredBalance, amount })
        expectedReturn = await rewardSwap.getExpectedReturn(amount)
        expectedReturn.sub(formulaReturn).should.be.lte.BN(delta)
      }
    })
  })

  describe('#constructor', () => {
    it('should initialize', async () => {
      const tokenFromContract = await rewardSwap.sacred()
      tokenFromContract.should.be.equal(sacred.address)
    })
  })

  it('should return as expected', async () => {
    const balanceBefore = await sacred.balanceOf(recipient)
    const expectedReturn = await rewardSwap.getExpectedReturn(amount)
    await rewardSwap.swap(recipient, amount, { from: sender })
    const balanceAfter = await sacred.balanceOf(recipient)
    balanceAfter.sub(balanceBefore).should.be.eq.BN(expectedReturn)
  })

  it('reverse rate', async () => {
    const tokens = await rewardSwap.getExpectedReturn(amount)
    const balance = await rewardSwap.sacredVirtualBalance()
    const points = reverseSacredFormula({ balance, tokens })
    points.sub(amount).should.be.lt.BN(toBN(1))
  })

  it('should be approximately additive', async () => {
    const amount = toBN(10).pow(toBN(10)).mul(toBN(2))
    const delta = toBN('1000') // max floating point error

    const balanceBefore1 = await sacred.balanceOf(recipient)
    await rewardSwap.swap(recipient, amount, { from: sender })
    const balanceAfter1 = await sacred.balanceOf(recipient)

    await revertSnapshot(snapshotId.result)
    snapshotId = await takeSnapshot()

    const balanceBefore2 = await sacred.balanceOf(recipient)
    await rewardSwap.swap(recipient, amount.div(toBN(2)), { from: sender })
    await rewardSwap.swap(recipient, amount.div(toBN(2)), { from: sender })
    const balanceAfter2 = await sacred.balanceOf(recipient)

    balanceBefore1.sub(balanceBefore2).should.be.lt.BN(delta)
    balanceAfter1.sub(balanceAfter2).should.be.lt.BN(delta)
  })

  describe('#swap', () => {
    it('should work as uniswap without vested tokens', async () => {
      const startTimestamp = await rewardSwap.startTimestamp()
      await rewardSwap.setTimestamp(startTimestamp)

      const expectedTokens = await rewardSwap.getExpectedReturn(amount)
      const formulaReturn = sacredFormula({ balance: initialSacredBalance, amount })
      expectedTokens.sub(formulaReturn).should.be.lte.BN(delta)
      const sacredVirtualBalance = await rewardSwap.sacredVirtualBalance()
      sacredVirtualBalance.should.be.eq.BN(initialSacredBalance)

      const balanceBefore = await sacred.balanceOf(recipient)
      await rewardSwap.swap(recipient, amount, { from: sender })
      const balanceAfter = await sacred.balanceOf(recipient)
      balanceAfter.should.be.eq.BN(balanceBefore.add(expectedTokens))
    })

    it('should work with vested tokens (a half of year passed)', async () => {
      let startTimestamp = await rewardSwap.startTimestamp()
      const currentTimestamp = startTimestamp.add(DURATION.div(toBN(2)))
      await rewardSwap.setTimestamp(currentTimestamp)

      const sacredVirtualBalance = await rewardSwap.sacredVirtualBalance()
      sacredVirtualBalance.should.be.eq.BN(yearLiquidity.div(toBN(2)).add(initialSacredBalance))

      const formulaReturn = sacredFormula({ balance: sacredVirtualBalance, amount })
      const expectedTokens = await rewardSwap.getExpectedReturn(amount)

      expectedTokens.sub(formulaReturn).should.be.lte.BN(delta)
      const balanceBefore = await sacred.balanceOf(recipient)
      await rewardSwap.swap(recipient, amount, { from: sender })
      const balanceAfter = await sacred.balanceOf(recipient)
      balanceAfter.should.be.eq.BN(balanceBefore.add(expectedTokens))
    })

    it('should not add any tokens after one year', async () => {
      let startTimestamp = await rewardSwap.startTimestamp()
      let currentTimestamp = startTimestamp.add(DURATION)
      await rewardSwap.setTimestamp(currentTimestamp)

      let sacredVirtualBalance = await rewardSwap.sacredVirtualBalance()
      sacredVirtualBalance.should.be.eq.BN(miningCap)

      const formulaReturn = sacredFormula({ balance: sacredVirtualBalance, amount })
      const expectedTokens = await rewardSwap.getExpectedReturn(amount)
      expectedTokens.sub(formulaReturn).should.be.lte.BN(delta)

      currentTimestamp = currentTimestamp.add(MONTH)
      await rewardSwap.setTimestamp(currentTimestamp)

      sacredVirtualBalance = await rewardSwap.sacredVirtualBalance()
      sacredVirtualBalance.should.be.eq.BN(miningCap)
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
  })
})
