import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { Clients, ClientsDocument } from '../schemas/user.schema.js';
import { SignupDto } from './dto/signup.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthenticatedUser } from './types/authenticated-user.type.js';

const BCRYPT_SALT_ROUNDS = 12;

export type JwtPayload = {
  sub: string;
  email: string;
  provider: Clients['provider'];
  githubUsername?: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Clients.name) private readonly clientsModel: Model<Clients>,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    const existing = await this.clientsModel.exists({ email: dto.email });
    if (existing) {
      throw new ConflictException('Email is already in use');
    }

    const created = await this.clientsModel.create({
      email: dto.email,
      password: passwordHash,
      provider: 'local',
    });

    const client = this.toSafeUser(created);

    const accessToken = await this.signAccessToken({
      userId: client._id.toString(),
      email: client.email,
      provider: client.provider,
      githubUsername: client.githubUsername,
    });

    return { client, accessToken };
  }

  async login(dto: LoginDto) {  
    const client = await this.clientsModel
      .findOne({ email: dto.email })
      .select('+password')
      .exec();

    if (!client || !client.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (client.provider !== 'local') {
      throw new UnauthorizedException(
        'This account uses GitHub sign-in. Please continue with GitHub.',
      );
    }

    const ok = await bcrypt.compare(dto.password, client!.password);
    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.signAccessToken({
      userId: client!._id.toString(),
      email: client!.email as string,
      provider: client.provider,
      githubUsername: client.githubUsername,
    });

    return { client: this.toSafeUser(client), accessToken };
  }

  async validateAndGetUser(userId: string) {
    const client = await this.clientsModel.findById(userId).exec();
    if (!client) {
      throw new NotFoundException('User not found');
    }

    return this.toSafeUser(client);
  }

  async upsertGithubUser(params: {
    githubId: string;
    githubUsername: string;
    email: string;
    encryptedAccessToken: string;
  }) {
    let client = await this.clientsModel
      .findOne({ githubId: params.githubId })
      .exec();

    if (!client) {
      client = await this.clientsModel.findOne({ email: params.email }).exec();
    }

    if (client) {
      client.githubId = params.githubId;
      client.githubUsername = params.githubUsername;
      client.githubAccessToken = params.encryptedAccessToken;
      if (!client.provider) {
        client.provider = 'github';
      }
      await client.save();
    } else {
      client = await this.clientsModel.create({
        email: params.email,
        provider: 'github',
        githubId: params.githubId,
        githubUsername: params.githubUsername,
        githubAccessToken: params.encryptedAccessToken,
      });
    }

    const safeUser = this.toSafeUser(client);
    const accessToken = await this.signAccessToken({
      userId: safeUser._id.toString(),
      email: safeUser.email,
      provider: safeUser.provider,
      githubUsername: safeUser.githubUsername,
    });

    return { client: safeUser, accessToken };
  }

  async getGithubAccessToken(userId: string) {
    const client = await this.clientsModel
      .findById(userId)
      .select('+githubAccessToken')
      .exec();

    if (!client?.githubAccessToken) {
      throw new UnauthorizedException(
        'GitHub is not connected for this account.',
      );
    }

    return client.githubAccessToken;
  }

  private async signAccessToken(params: AuthenticatedUser) {
    const payload: JwtPayload = {
      sub: params.userId,
      email: params.email,
      provider: params.provider,
      githubUsername: params.githubUsername,
    };
    return this.jwtService.signAsync(payload);
  }

  private toSafeUser(client: ClientsDocument | (Clients & { _id: { toString(): string } })) {
    const json =
      'toJSON' in client && typeof client.toJSON === 'function'
        ? client.toJSON()
        : { ...client };
    delete json.password;
    delete json.githubAccessToken;
    return json;
  }
}

